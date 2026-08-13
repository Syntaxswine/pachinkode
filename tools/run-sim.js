// Play whole runs with nobody at the controls, and report what happened.
//
//   node tools/run-sim.js                      # 20 runs on the stock cabinet
//   node tools/run-sim.js --cab uramono --n 8
//   node tools/run-sim.js --curve              # the difficulty curve, per floor
//   node tools/run-sim.js --sites              # per-bucket entry counts
//   node tools/run-sim.js --greedy value       # a different drafting brain
//   node tools/run-sim.js --push bank|push|thrifty   # the push-or-bank policy
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// The operator asked for a specific SHAPE: much harder at the start, and past a
// threshold of unlocks, increasingly easy to reach absurd scores. That is a
// claim about two curves crossing, and there is exactly one honest way to know
// whether the constants in run.js produce it — play it, several hundred times,
// and look.
//
// Everything this tool prints is a measurement of the real simulation: real
// physics at 1200 Hz, real board geometry rebuilt for every part taken, the
// real lottery. Nothing is modelled twice. The auto-player is the only fiction,
// and its limits are stated below.
//
// ── WHAT THE AUTO-PLAYER IS AND IS NOT ──────────────────────────────────────
//
// It holds a base dial, cranks right during a jackpot or a small win, and takes
// the best-looking part on offer. It is a COMPETENT player, not a good one: it
// does not aim at a bucket it has just been given, it does not read the board,
// and it never varies its dial to chase a chain. Every number here is therefore
// a FLOOR on what a human can do, which is the useful direction for a
// difficulty measurement to be wrong in — if the machine is beatable by this,
// it is beatable.

import { Machine, FIRE_RATES, WAVE, waveW } from '../src/sim/machine.js'
import { DT } from '../src/sim/world.js'
import { Run, quotaFor, QUOTA_BASE, QUOTA_GROWTH, BALLS_BASE, FLOORS, LAST_FLOOR } from '../src/sim/run.js'
import { CABINETS, CABINET_ORDER } from '../src/sim/cabinets.js'
import { PART_BY_ID, drawOffers, resolveLoadout } from '../src/sim/loadout.js'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
const num = (n, d) => +arg(n, d)

const RATE = FIRE_RATES[arg('rate', 'arcade')].interval
const BASE_DIAL = num('dial', 0.20)
const MIGI = 0.88

// ── the drafting brain ──────────────────────────────────────────────────────
//
// Three policies, because "is the curve right" and "is the curve right for a
// player who only ever takes multipliers" are different questions, and a
// catalogue where one policy dominates is a catalogue with a dead half.
const BRAINS = {
  // Take whatever is offered first. The honest baseline: a player who has not
  // worked anything out yet. If the curve only works for an optimiser, it does
  // not work.
  naive: (offers) => offers[0],
  // Rate first, then value, then economy. Roughly what a good player does.
  balanced: (offers) => {
    const rank = { bucket: 0, widen: 1, balls: 2, bucketvalue: 3, mult: 4, combostep: 5 }
    return [...offers].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9))[0]
  },
  // Multipliers above all. The obvious trap policy: it looks strongest and
  // starves the board of scoring EVENTS to multiply.
  value: (offers) => {
    const rank = { mult: 0, bucketvalue: 1, hesovalue: 2, combostep: 3 }
    return [...offers].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9))[0]
  }
}
const BRAIN = BRAINS[arg('greedy', 'balanced')] || BRAINS.balanced

// ── the push-or-bank policy ─────────────────────────────────────────────────
//
// Meeting the quota no longer ends a floor; it opens a choice. Surplus score
// buys extra parts (doubling: 2× the quota for one, 4× for two, 8× for three),
// and banking carries the rest of the tray into the next floor.
//
// There is no obviously correct answer, which is the point, so the tool
// measures three policies rather than assuming one. `thrifty` is the default
// because it is the conservative read — bank unless the next part looks
// reachable — and a curve that only works for the greedy policy is not a curve.
//
// A policy answers "keep pushing?" and is asked EVERY STEP once the quota is
// met, because that is what the game now does: the floor never pauses, and
// banking is a live door rather than a modal question. `thrifty` therefore
// re-estimates as the tray drains and can change its mind mid-push — which is
// what the player it models would do with the same two numbers.
const PUSH = {
  bank: () => false,
  push: () => true,
  thrifty: (run) => {
    const at = run.nextPickAt()
    if (at === null) return false                 // ceiling reached; bank it
    // Extrapolate from this floor's own rate: can the tray in hand plausibly
    // cover the gap to the next part? Rough on purpose — the player is
    // estimating too, from the same two numbers the screen prints.
    const perBall = run.floorScore / Math.max(1, run.launched)
    return (at - run.floorScore) < perBall * run.ballsLeft * 0.7
  }
}
const PUSH_POLICY = PUSH[arg('push', 'thrifty')] || PUSH.thrifty

// ── the wave's firing policies ──────────────────────────────────────────────
//
// The wave (machine.js WAVE) split "when do I fire" into strategies, and the
// operator's design predicts a tradeoff: crest-surfing chases jackpots
// (BALLS), steady fire feeds the chain (SCORE, and most of it). These three
// brains exist to measure whether the strategies actually separate:
//
//   steady — fires always: the metronome. The chain's best friend.
//   surf   — fires only in the high tide (waveW > 0.55), rests the trough.
//   drip   — the discovered hybrid: a one-third duty cycle through the trough,
//            just enough scoring traffic to keep the chain window alive, then
//            full fire at the crest. Deliberately un-taught in the game.
//
// All three harvest during a party regardless — not firing at an open
// attacker is not a strategy, it is a bug in the player.
const FIRE = {
  steady: () => true,
  surf: (m) => waveW(m.wavePhase) > 0.55,
  drip: (m) => waveW(m.wavePhase) > 0.55 || Math.floor(m.time / 0.9) % 3 === 0
}
let FIRE_POLICY = FIRE[arg('fire', 'steady')] || FIRE.steady

/**
 * Play one floor to its conclusion. Returns when the run leaves 'playing'.
 *
 * A fresh Machine per floor, because the board is a function of the loadout and
 * a part taken between floors is new brass. The machine's token balance is
 * seeded from the run's allowance and is thereafter the authority on how many
 * balls are left — see run.js.
 */
function playFloor (run, seed, siteTally) {
  const m = new Machine({
    seed,
    spec: run.cabinet.spec,
    tokens: run.ballsLeft,
    fireInterval: RATE,
    loadout: run.loadout
  })
  m.dial = BASE_DIAL
  m.firing = true

  // A floor cannot run forever even in principle, but a floor whose payouts
  // outpace its launches can run for a very long time, and this is a batch
  // tool. The guard is a wall-clock backstop, not a rule of the game — it is
  // deliberately far above any real floor (20× the allowance in launches).
  const launchCap = run.ballsAtStart * 20
  let guard = 0
  const maxSteps = 90 * 60 * 1200      // 90 simulated minutes

  while (run.status === 'playing' && guard++ < maxSteps) {
    // The run owns the clock; the machine owns the tray. Keeping the tray
    // topped up to the run's remaining launches is what makes the two agree on
    // screen without either one reaching into the other's bookkeeping — the
    // machine's spent/won ledger stays honest either way, because those move on
    // launches and payouts rather than on the balance.
    m.tokens = Math.max(0, run.ballsLeft)
    m.firing = run.ballsLeft > 0 && m.launched < launchCap &&
      (m.inJackpot || m.koatari || FIRE_POLICY(m))
    m.dial = (m.inJackpot || m.koatari) ? MIGI : BASE_DIAL
    m.step(DT)
    const evs = m.drain()
    if (siteTally) for (const ev of evs) if (ev.type === 'bucket') {
      siteTally[ev.site] = (siteTally[ev.site] || 0) + 1
    }
    run.observe(evs, DT, { inFlight: m.world.balls.length })
    // The decision, taken by policy — every step, while the floor stays live.
    // (An earlier modal version left unanswered hung the floor forever: the
    // outer loop re-played floor 1 three hundred and ninety-seven times and
    // reported a 0% clear rate. The live door cannot hang — a policy that
    // never banks simply spends the tray and clears on the way down.)
    if (run.status === 'playing' && run.metQuota && !PUSH_POLICY(run)) run.bank()
    if (run.status !== 'playing') break
    if (run.ballsLeft <= 0 && m.world.balls.length === 0) break
    if (m.launched >= launchCap && m.world.balls.length === 0) break
  }
  // If a guard broke the loop while the run still thought it was playing, the
  // floor did not end — and the caller's `while` would hand the SAME floor back
  // to be played again, quietly inflating every per-floor statistic. (It did:
  // the first curve run reported nine floor-1 attempts across eight runs.) A
  // floor the auto-player could not finish is a floor it did not clear.
  if (run.status === 'playing') run.fail()
  return { launched: m.launched, rtp: m.rtp, jackpots: m.jackpots }
}

/** Play a whole run. Returns the finished Run plus a per-floor trace. */
function playRun (cabKey, seed, siteTally) {
  const run = new Run(CABINETS[cabKey], seed)
  const trace = []
  // OVERTIME is unbounded by design, so this loop needs a stop and the stop
  // has to be VISIBLE. A batch tool that silently truncates a run reports
  // "cleared 100%" for a floor it simply stopped watching, which reads as data.
  // Overridable, because OVERTIME got dramatically longer once balls could be
  // banked: a deep run carries a tray big enough that each floor is a genuine
  // simulated hour, and 16 of them against a 132-floor cap does not finish. The
  // curve only needs the first twelve; --cap raises it when the question really
  // is how deep overtime goes.
  const FLOOR_CAP = num('cap', FLOORS + 24)
  let guard = 0
  while (!run.finished && guard++ < FLOOR_CAP) {
    const floor = run.floor
    const quota = run.quota
    const balls = run.ballsLeft
    const stats = playFloor(run, seed * 1000 + floor, siteTally)
    trace.push({
      floor, quota, balls,
      score: run.floorScore,
      // 'closed' is a CLEAR too — it is the last floor, cleared, ending the
      // run. Counting only 'cleared' printed the last floor as 0% cleared
      // forever, which read as a wall the instrument had invented.
      cleared: run.status === 'cleared' || run.status === 'closed',
      launched: stats.launched,
      jackpots: stats.jackpots,
      launchedAtQuota: run.launchedAtQuota || stats.launched,
      bestChain: run.bestChain,
      parts: run.loadout.parts.length
    })
    run.drain()
    // Drain the back room: from floor 4 it deals more than once.
    let picks = 0
    while (run.status === 'cleared' && picks++ < 6) {
      const pick = BRAIN(run.offers)
      if (pick) run.take(pick.id); else run.skip()
      run.drain()
    }
  }
  if (!run.finished) {
    truncated++
  }
  return { run, trace }
}

let truncated = 0

// ── modes ───────────────────────────────────────────────────────────────────

const pct = (x) => (x * 100).toFixed(0) + '%'
const nf = (x) => Math.round(x).toLocaleString('en-US')

if (flag('sites')) {
  // Per-bucket entry counts. This is the REAL reachability answer that the
  // geometry audit deliberately refuses to guess at: a site that never sees a
  // ball is a dead draft pick however clean its walls are.
  const tally = {}
  const N = num('n', 6)
  const cab = CABINETS[arg('cab', 'floor')]   // review: --sites was hardwired to the stock cabinet
  console.log(`\n  bucket entries over ${N} runs on a fully-bucketed ${cab.label} board\n`)
  let expected = []
  for (let i = 0; i < N; i++) {
    const run = new Run(cab, i + 1)
    for (let k = 0; k < 7; k++) PART_BY_ID.bucket.available(run.loadout) && PART_BY_ID.bucket.apply(run.loadout)
    expected = run.loadout.buckets.map(b => b.site)
    playFloor(run, i + 1, tally)
  }
  const rows = Object.entries(tally).sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, r) => s + r[1], 0) || 1
  for (const [site, n] of rows) {
    console.log(`    ${site.padEnd(10)} ${String(n).padStart(6)}   ${pct(n / total).padStart(5)}` +
      `  ${'█'.repeat(Math.round(40 * n / rows[0][1]))}`)
  }
  // The dead list derives from the board that WAS BUILT — a literal list
  // reported motif-absent sites as dead and motif-dead sites as fine
  // (review finding; also the vugg lesson about instruments and stale maps).
  const dead = expected.filter(s => !tally[s])
  console.log(dead.length
    ? `\n  DEAD SITES (never scored): ${dead.join(', ')}\n`
    : `\n  Every site scores. No dead draft picks.\n`)
  process.exit(0)
}

if (flag('power')) {
  // How much is a part actually WORTH?
  //
  // This is the measurement the quota curve has to be fitted against, and I
  // guessed at it twice before building it — both times high. Play a fixed
  // 160-ball floor with k parts already fitted, with an unreachable quota so
  // the floor always runs to the last ball, and read the mean score. The ratio
  // between consecutive k is the per-part multiplier, and it is the number that
  // decides whether QUOTA_GROWTH is survivable.
  const N = num('n', 6)
  const MAX = num('max', 10)
  console.log(`\n  scoring power vs parts fitted — ${arg('greedy', 'balanced')} drafting, ` +
    `${N} floors each, quota unreachable so every floor runs the full tray\n`)
  console.log('   parts   mean floor score   ×prev   ×stock')
  let prev = null, stock = null
  for (let k = 0; k <= MAX; k++) {
    const scores = []
    for (let i = 0; i < N; i++) {
      const run = new Run(CABINETS.floor, i + 101)
      // Draft k parts using the real offer stream, then make the floor endless.
      for (let j = 0; j < k; j++) {
        const offers = drawOffers(run.loadout, run.rng, 3)
        const pick = BRAIN(offers)
        if (pick) resolveLoadout([pick.id], run.loadout)
      }
      run.quota = Infinity
      run.ballsLeft = run.ballsAtStart = 160 + run.loadout.ballBonus
      playFloor(run, i + 101)
      scores.push(run.floorScore)
    }
    const mean = scores.reduce((s, x) => s + x, 0) / N
    if (stock === null) stock = mean
    console.log(`   ${String(k).padStart(5)}   ${nf(mean).padStart(16)}   ` +
      `${(prev ? (mean / prev).toFixed(2) : '  — ').padStart(5)}   ${(mean / stock).toFixed(2)}×`)
    prev = mean
  }
  console.log(`\n  QUOTA_GROWTH is ${QUOTA_GROWTH}. A floor is survivable only if the parts ` +
    `taken\n  between two floors are worth more than that.\n`)
  process.exit(0)
}

if (flag('wavecheck')) {
  // Race the three firing brains on the SAME seeds and see whether the wave's
  // designed tradeoff is real: surf should buy jackpots-per-launch (balls),
  // steady should buy chain share (score), drip should sit between — or
  // beat both, which is what makes it worth leaving in as a discovery.
  const N = num('n', 8)
  const cab = arg('cab', 'floor')
  console.log(`\n  the wave check — ${CABINETS[cab].label}, ${N} runs per policy, same seeds`)
  console.log(`  WAVE period ${WAVE.period}s crest ${WAVE.crest} boost ${WAVE.boost}× · welcome ${WAVE.welcomePeriod}s at ${WAVE.welcomeBoost}×\n`)
  console.log('  policy    floors   score(med)    chain-share   best chain   jackpots/1k balls')
  console.log('  ' + '─'.repeat(78))
  for (const name of ['steady', 'surf', 'drip']) {
    FIRE_POLICY = FIRE[name]
    const rows = []
    for (let s = 0; s < N; s++) {
      const { run, trace } = playRun(cab, s + 41)
      const launched = trace.reduce((a, t) => a + t.launched, 0)
      const P = run.provenance
      rows.push({
        floors: trace.length,
        score: run.score,
        share: P.fromChain / Math.max(1, P.base + P.fromChain),
        chain: run.bestChain,
        jpk: 1000 * trace.reduce((a, t) => a + (t.jackpots || 0), 0) / Math.max(1, launched)
      })
    }
    const med = (k) => rows.map(r => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
    const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length
    console.log(`  ${name.padEnd(8)} ${mean('floors').toFixed(1).padStart(6)}   ${nf(med('score')).padStart(10)}   ` +
      `${pct(mean('share')).padStart(11)}   ${med('chain').toFixed(0).padStart(10)}   ${mean('jpk').toFixed(1).padStart(8)}`)
  }
  console.log('\n  same seeds per policy — differences are the BRAIN, not the dice.\n')
  process.exit(0)
}

if (flag('curve')) {
  // The headline measurement. For each floor, how often does a run that
  // REACHED it clear it, and by how much?
  const N = num('n', 24)
  const cab = arg('cab', 'floor')
  console.log(`\n  difficulty curve — ${CABINETS[cab].label}, ${N} runs, ` +
    `${arg('greedy', 'balanced')} drafting, ${arg('push', 'thrifty')} push, ${arg('rate', 'arcade')}`)
  console.log(`  quota = ${nf(QUOTA_BASE)} × ${QUOTA_GROWTH}^(floor−1) × ` +
    `${CABINETS[cab].difficulty}   ·   ${BALLS_BASE} balls + parts\n`)
  // ── the metric, and why it is not score/quota ────────────────────────────
  //
  // The obvious measurement is mean score ÷ quota, and it is worthless here: a
  // floor ENDS the instant the quota is met, so a cleared floor's ratio is
  // pinned just above 1.00 by construction and every floor in the run reports
  // "1.00×" whether it was a scrape or a rout. The first version of this tool
  // printed exactly that column, ten identical bars, and it looked like data.
  //
  // What actually separates a hard floor from a trivial one is COST: how much
  // of the ball allowance the clear consumed. A floor cleared on 90% of the
  // tray is a knife fight; one cleared on 12% is a formality. That number is
  // free to fall as far as the parts can push it, which is precisely the shape
  // the operator asked to see.
  // Keyed rather than fixed-length: since clearing floor 12 opens OVERTIME
  // instead of ending the run, the floor number is unbounded and a
  // FLOORS-sized array throws the first time a run gets good.
  const reached = {}
  const cleared = {}
  const cost = {}
  const bump = (o, f, v) => { (o[f] = o[f] || []).push(v) }
  let wins = 0, closes = 0
  const deaths = []
  const scores = []
  for (let i = 0; i < N; i++) {
    const { run, trace } = playRun(cab, i + 1)
    for (const t of trace) {
      reached[t.floor] = (reached[t.floor] || 0) + 1
      if (t.cleared) {
        cleared[t.floor] = (cleared[t.floor] || 0) + 1
        bump(cost, t.floor, t.launchedAtQuota / t.balls)
      }
    }
    if (run.cleared) wins++
    if (run.closed) closes++; else deaths.push(run.floor)
    scores.push(run.score)
  }
  const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN
  console.log('   floor   quota      reached  cleared   tray spent TO MEET THE QUOTA')
  const deepest = Math.max(...Object.keys(reached).map(Number))
  for (let f = 1; f <= deepest; f++) {
    if (!reached[f]) continue
    const c = mean(cost[f] || [])
    // Clamped, and flagged when it is. Deep in OVERTIME a floor can cost many
    // times its allowance (BALL RETURN keeps stretching the tray), and an
    // unclamped bar prints three hundred blocks and destroys the table.
    const over = c > 1
    const bar = Number.isNaN(c) ? '' : '█'.repeat(Math.max(1, Math.round(Math.min(1, c) * 30))) +
      (over ? '▸' : '')
    console.log(`   ${String(f).padStart(4)}${f > FLOORS ? '+' : ' '} ` +
      `${nf(quotaFor(f, null, CABINETS[cab].difficulty)).padStart(11)}` +
      `   ${String(reached[f]).padStart(6)}   ${pct((cleared[f] || 0) / reached[f]).padStart(5)}` +
      `   ${(Number.isNaN(c) ? '    —' : pct(c).padStart(5))}  ${bar}`)
  }
  scores.sort((a, b) => a - b)
  console.log(`\n  runs won: ${wins}/${N}   median score ${nf(scores[N >> 1])}` +
    `   best ${nf(scores[N - 1])}`)
  // CLOSING TIME: the run has an end now, so the question is no longer how
  // deep overtime goes but whether the last floor is REACHABLE and a FIGHT.
  // Both failure modes are bad: nobody closing means the cap is decoration,
  // everybody closing means overtime is still a victory lap with a door on it.
  deaths.sort((a, b) => a - b)
  const dmed = deaths.length ? deaths[deaths.length >> 1] : null
  console.log(`  reached CLOSING TIME (floor ${LAST_FLOOR}): ${closes}/${N}` +
    (deaths.length ? `   the other ${deaths.length} died on floor ` +
      `${deaths[0]}–${deaths[deaths.length - 1]} (median ${dmed})` : ''))
  // The crossover: the first floor from which clearing costs less than HALF the
  // tray, and never costs more again. That is the moment the player's curve has
  // overtaken the wall for good — before it, every floor is a fight to the last
  // ball; after it, the quota is a formality and the remaining balls are pure
  // score. It is the one number this whole tool is for.
  let crossover = null
  for (let f = 1; f <= FLOORS; f++) {
    if (!(cost[f] || []).length) continue
    const ok = []
    for (let g = f; g <= FLOORS; g++) {
      if (!(cost[g] || []).length) continue
      ok.push(mean(cost[g]) < 0.5)
    }
    if (ok.length && ok.every(Boolean)) { crossover = f; break }
  }
  console.log(`  crossover floor: ${crossover ?? 'never'}` +
    `   (target 4–8: earlier is a pushover, later is a wall)`)
  // This band has moved twice, each time by a ruling the tool then enforced.
  // It started at 35–55%, which the tool itself proved wrong: clear rates
  // COMPOUND (four floors at 50% = 6% see floor 5), so early difficulty must
  // live in the MARGIN, not the failure rate — that gave 60–75%. Then the
  // operator ruled floor 1 an ON-RAMP (FLOOR1_EASE in run.js, 2026-07-28):
  // easy to finish, worth exactly one part, with the filter moved to floor 2.
  // A target band must encode the CURRENT ruling or the instrument cries wolf
  // at a number the design chose on purpose.
  console.log(`  floor-1 clear rate: ${pct((cleared[1] || 0) / (reached[1] || 1))}` +
    `   (target ≥85%: the on-ramp — the filter is floor 2, the crunch 2–3)\n`)
  process.exit(0)
}

// ── default: a batch of runs, summarised ────────────────────────────────────

const N = num('n', 20)
const cabs = arg('cab', null) ? [arg('cab')] : CABINET_ORDER
console.log(`\n  ${N} runs per cabinet · ${arg('greedy', 'balanced')} drafting · ` +
  `${arg('rate', 'arcade')}\n`)
console.log('   cabinet        diff   floors (mean/best)   won    median score      best')
for (const key of cabs) {
  const floors = []
  const scores = []
  let wins = 0
  for (let i = 0; i < N; i++) {
    const { run } = playRun(key, i + 1)
    floors.push(run.floor)
    scores.push(run.score)
    if (run.cleared) wins++
  }
  scores.sort((a, b) => a - b)
  const meanF = floors.reduce((s, x) => s + x, 0) / N
  console.log(`   ${CABINETS[key].label.padEnd(16)} ${String(CABINETS[key].difficulty).padStart(4)}` +
    `   ${meanF.toFixed(1).padStart(5)} / ${String(Math.max(...floors)).padStart(2)}` +
    `        ${String(wins).padStart(2)}/${N}  ${nf(scores[N >> 1]).padStart(12)}  ${nf(scores[N - 1]).padStart(10)}`)
}
console.log('')
