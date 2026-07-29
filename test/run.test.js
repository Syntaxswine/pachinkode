import test from 'node:test'
import assert from 'node:assert/strict'

import { Run, quotaFor, picksFor, ballsFor, BALLS_BASE, chainMult, SCORE, FLOORS, QUOTA_GROWTH, MAX_SURPLUS_PICKS, SCORE_ORIGIN } from '../src/sim/run.js'
import {
  baseLoadout, resolveLoadout, drawOffers, partAvailable, countPart,
  PARTS, PART_BY_ID, BUCKET_SITES, SITE_ORDER, BUCKET_MOUTH_MAX
} from '../src/sim/loadout.js'
import { CABINETS, CABINET_ORDER, isUnlocked, newMeta, recordRun, RUNS_KEPT } from '../src/sim/cabinets.js'
import { buildBoard } from '../src/sim/board.js'
import { Machine } from '../src/sim/machine.js'
import { makeRng } from '../src/sim/rng.js'

const cab = CABINETS.floor

// ── design law L4, extended to the roguelike ────────────────────────────────
//
// The varnish switch only means anything if nothing downstream of the
// simulation can reach back into it. A SCORE is the most dangerous thing this
// project has ever added on that front: scores want to be fed back as
// difficulty, and the moment one is, "same seed, same physics, same odds" stops
// being true and the whole exhibit is a lie with a slider on it.
//
// So the Run gets the same test the Machine got: it must expose no
// presentation surface at all, and the Machine must not know it exists.

test('the Run exposes no presentation surface', () => {
  const run = new Run(cab, 7)
  const banned = /varnish|colou?r|sound|volume|render|draw|hue|flash|audio|synth|pulse/i
  for (const k of Object.keys(run)) {
    assert.ok(!banned.test(k), `Run has a presentation-shaped member "${k}"`)
  }
  for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(run))) {
    assert.ok(!banned.test(k), `Run has a presentation-shaped method "${k}"`)
  }
})

test('the Machine does not know a Run exists', () => {
  const m = new Machine({ seed: 3 })
  for (const k of Object.keys(m)) {
    assert.ok(!/run|score|quota|chain|floor/i.test(k),
      `Machine has a run-shaped member "${k}" — the simulation must not see the roguelike`)
  }
})

test('scoring reads nothing from the machine but its events', () => {
  // Two runs fed identical event batches must score identically, regardless of
  // what machine produced them. If the Run ever starts consulting live machine
  // state this breaks.
  const mk = () => new Run(cab, 11)
  const evs = [
    { type: 'bucket', value: 1, x: 0.1, y: 0.3, site: 'westLow' },
    { type: 'heso', x: 0.22, y: 0.32 },
    { type: 'tulip', x: 0.12, y: 0.34 }
  ]
  const a = mk(); const b = mk()
  for (const e of evs) a.observe([e], 0.016, { inFlight: 1 })
  for (const e of evs) b.observe([e], 0.016, { inFlight: 9 })
  assert.equal(a.floorScore, b.floorScore)
  assert.ok(a.floorScore > 0)
})

// ── the loadout is really the board ─────────────────────────────────────────

test('a part changes the geometry, not a multiplier on it', () => {
  const stock = buildBoard(baseLoadout())
  const more = buildBoard(resolveLoadout(['bucket', 'bucket']))
  assert.equal(stock.parts.buckets.length, 2)
  assert.equal(more.parts.buckets.length, 4)
  assert.ok(more.world.segments.length > stock.world.segments.length,
    'extra buckets added no walls — the cup is not a cup')
  assert.ok(more.world.sensors.length > stock.world.sensors.length)
})

test('bending the life nails really moves them', () => {
  const stock = buildBoard(baseLoadout())
  const bent = buildBoard(resolveLoadout(['lifenails', 'lifenails']))
  const gap = (b) => {
    const [l, r] = b.parts.lifeNails
    return Math.hypot(l.x - r.x, l.y - r.y) - l.r - r.r
  }
  assert.ok(gap(bent) > gap(stock) + 0.002,
    `heso gap did not open: ${(gap(stock) * 1000).toFixed(2)} → ${(gap(bent) * 1000).toFixed(2)} mm`)
})

test('every bucket site is placeable at the widest mouth', () => {
  // buildBoard THROWS if a site would foul the launch channel. Seven buckets at
  // the widening cap is the worst case a run can reach, and a player reaching
  // it must not meet an exception.
  const L = resolveLoadout(Array(SITE_ORDER.length).fill('bucket'))
  L.bucketMouth = BUCKET_MOUTH_MAX
  const built = buildBoard(L)
  assert.equal(built.parts.buckets.length, SITE_ORDER.length)
  for (const s of SITE_ORDER) assert.ok(BUCKET_SITES[s], `site "${s}" is in the order but not defined`)
})

test('parts respect their own caps', () => {
  for (const p of PARTS) {
    const L = baseLoadout()
    for (let i = 0; i < (p.max || 1) + 4; i++) if (partAvailable(L, p)) resolveLoadout([p.id], L)
    assert.ok(countPart(L, p.id) <= (p.max || 1),
      `${p.id} exceeded its max of ${p.max}: fitted ${countPart(L, p.id)}`)
  }
})

test('a draft never offers the same part twice', () => {
  const rng = makeRng(5)
  for (let i = 0; i < 200; i++) {
    const L = baseLoadout()
    const offers = drawOffers(L, rng, 3)
    const ids = offers.map(o => o.id)
    assert.equal(new Set(ids).size, ids.length, `duplicate in a draft: ${ids.join(', ')}`)
    for (const o of offers) assert.ok(partAvailable(L, o), `offered an unavailable part: ${o.id}`)
  }
})

test('an unknown part id is skipped, not thrown on', () => {
  // A save written by an older build must still open. Losing a part is
  // survivable; losing the save is not.
  const L = resolveLoadout(['bucket', 'no-such-part-exists', 'mult'])
  assert.equal(L.buckets.length, 3)
  assert.ok(L.scoreMult > 1)
})

// ── the clock ───────────────────────────────────────────────────────────────

test('a launch spends a ball and a foul gives it back', () => {
  const run = new Run(cab, 2)
  const start = run.ballsLeft
  run.observe([{ type: 'launch' }, { type: 'launch' }], 0.016, { inFlight: 2 })
  assert.equal(run.ballsLeft, start - 2)
  run.observe([{ type: 'foul' }], 0.016, { inFlight: 1 })
  assert.equal(run.ballsLeft, start - 1,
    'a fouled ball never entered play and must not be charged for')
})

test('payouts do not touch the clock without BALL RETURN', () => {
  const run = new Run(cab, 2)
  const start = run.ballsLeft
  run.observe([{ type: 'pay', n: 40, source: 'attacker' }], 0.016, { inFlight: 1 })
  assert.equal(run.ballsLeft, start,
    'the tray refilled the clock — floors stop ending when this happens')
})

test('BALL RETURN converts payouts into launches, in whole balls', () => {
  const run = new Run(cab, 2)
  resolveLoadout(['refund'], run.loadout)            // 25%
  const start = run.ballsLeft
  run.observe([{ type: 'pay', n: 2 }], 0.016, { inFlight: 1 })
  assert.equal(run.ballsLeft, start, 'half a ball was launched')
  run.observe([{ type: 'pay', n: 2 }], 0.016, { inFlight: 1 })
  assert.equal(run.ballsLeft, start + 1, 'the accumulated quarters did not cash in')
})

test('the floor does not end while a ball is still in the air', () => {
  const run = new Run(cab, 2)
  run.ballsLeft = 0
  run.observe([], 0.016, { inFlight: 1 })
  assert.equal(run.status, 'playing', 'cut the player off mid-shot')
  run.observe([], 0.016, { inFlight: 0 })
  assert.equal(run.status, 'failed')
})

// ── the chain ───────────────────────────────────────────────────────────────

test('the first ball of a chain is already worth more than one', () => {
  // The Peggle choice: credit arrives on the ball that earned it, not the next.
  const L = baseLoadout()
  assert.ok(chainMult(1, L) > 1)
  assert.equal(chainMult(0, L), 1)
})

test('the chain dies of silence, not of a drain', () => {
  const run = new Run(cab, 4)
  run.observe([{ type: 'heso', x: 0, y: 0 }], 0.016, { inFlight: 1 })
  assert.equal(run.chain, 1)
  // Most balls drain. Punishing that would make the chain a measure of luck.
  run.observe([{ type: 'drain', x: 0, y: 0 }], 0.016, { inFlight: 1 })
  assert.equal(run.chain, 1, 'a drain broke the chain')
  run.observe([], run.loadout.comboWindow + 0.1, { inFlight: 1 })
  assert.equal(run.chain, 0, 'the chain survived its own window')
})

test('the chain multiplier is capped', () => {
  const L = baseLoadout()
  assert.equal(chainMult(L.comboCap + 500, L), chainMult(L.comboCap, L))
})

// ── the curve ───────────────────────────────────────────────────────────────

test('the quota grows geometrically and never goes backwards', () => {
  let prev = 0
  for (let f = 1; f <= FLOORS + 8; f++) {
    const q = quotaFor(f, null, 1)
    assert.ok(q > prev, `floor ${f} asks for less than floor ${f - 1}`)
    if (f > 1) {
      const ratio = q / quotaFor(f - 1, null, 1)
      assert.ok(Math.abs(ratio - QUOTA_GROWTH) < 0.02,
        `floor ${f} is off the curve at ×${ratio.toFixed(3)}`)
    }
    prev = q
  }
})

test('picks rise with depth — this is what makes the curve cross', () => {
  // The measured per-part power is ×1.30 against a wall of ×1.30. One pick a
  // floor is therefore two parallel lines and no crossover at any base; the
  // rising pick count is the whole mechanism. If a future builder flattens this
  // to a constant, the run becomes unwinnable and this test says so first.
  assert.equal(picksFor(1), 1)
  assert.ok(picksFor(FLOORS) > picksFor(1),
    'picks do not rise with depth — the difficulty curve can no longer cross')
  let prev = 0
  for (let f = 1; f <= FLOORS + 8; f++) {
    const p = picksFor(f)
    assert.ok(p >= prev, `picks fell at floor ${f}`)
    assert.ok(p >= 1, `floor ${f} deals no parts at all`)
    prev = p
  }
})

test('SOFTER QUOTA lowers the wall and cannot invert it', () => {
  const L = resolveLoadout(['relief', 'relief', 'relief'])
  assert.ok(L.quotaRelief > 0 && L.quotaRelief < 1)
  for (let f = 1; f <= FLOORS; f++) {
    assert.ok(quotaFor(f, L, 1) < quotaFor(f, null, 1))
    assert.ok(quotaFor(f, L, 1) > 0)
  }
})

// ── floors, drafts, overtime ────────────────────────────────────────────────

/** Score a run to its quota without simulating any physics. */
function toQuota (run) {
  let guard = 0
  while (run.status === 'playing' && !run.metQuota && guard++ < 40000) {
    run.observe([{ type: 'bucket', value: 1, x: 0.1, y: 0.3, site: 'westLow' }], 0.001,
      { inFlight: 1 })
  }
  return guard
}

/** Reach the quota and bank — the plain path through a floor. */
function clearFloor (run) {
  toQuota(run)
  if (run.status === 'playing' && run.metQuota) run.bank()
  return run
}

// ── the decision: push on, or bank the tray ─────────────────────────────────
//
// The decision is LIVE: meeting the quota does not pause the floor or change
// its status. It opens `bank()` — a door, not a menu. Pushing on is simply
// continuing to fire, so there is no pushOn() to test; what must hold instead
// is that the floor stays fully alive after the quota, and that the door
// opens exactly once, exactly then, and closes exactly when the floor ends.

test('meeting the quota keeps the floor live instead of pausing it', () => {
  const run = new Run(cab, 9)
  toQuota(run)
  assert.equal(run.status, 'playing', 'the quota froze the floor')
  assert.equal(run.metQuota, true)
  assert.ok(run.floorScore >= run.quota)
  assert.ok(run.ballsLeft > 0, 'the decision is meaningless with an empty tray')
  const ev = run.drain().find(e => e.type === 'quotaMet')
  assert.ok(ev, 'no quotaMet event')
  assert.equal(ev.ballsLeft, run.ballsLeft)
  assert.ok(ev.nextPickAt > run.floorScore, 'the next part must be a stated price')
})

test('the door is shut before the quota and after the floor', () => {
  const run = new Run(cab, 9)
  assert.equal(run.bank(), false, 'banked a floor that had not been cleared')
  assert.equal(run.status, 'playing')
  toQuota(run)
  assert.equal(run.bank(), true)
  assert.equal(run.status, 'cleared')
  assert.equal(run.bank(), false, 'banked the same floor twice')
})

test('balls in flight when the door is taken resolve for nothing', () => {
  // Run#bank documents the forfeit as a ruling, not an accident — timing is
  // part of the choice. Pinned so a future refactor of the status guard in
  // add()/observe() cannot silently un-make it (review finding: the rule was
  // enforced only incidentally).
  const run = new Run(cab, 9)
  toQuota(run)
  run.bank()
  const score = run.score, fs = run.floorScore, picks = run.picksLeft
  run.observe([{ type: 'bucket', value: 1, x: 0.1, y: 0.3, site: 'westLow' }], 0.001,
    { inFlight: 1 })
  assert.equal(run.score, score, 'a closed book took a score')
  assert.equal(run.floorScore, fs)
  assert.equal(run.picksLeft, picks, 'a late ball bought a pick')
})

test('the carry is capped at one base tray', () => {
  // Uncapped, banking is a geometric series that converges near four thousand
  // balls — a thirteen-minute floor. See Run#bank.
  const run = new Run(cab, 9)
  run.metQuota = true
  run.ballsLeft = 5000
  run.bank()
  assert.equal(run.banked, BALLS_BASE)
})

test('banking carries the tray into the next floor, on top of its allowance', () => {
  const run = new Run(cab, 9)
  toQuota(run)
  const left = run.ballsLeft
  assert.ok(left > 0)
  run.bank()
  assert.equal(run.status, 'cleared')
  assert.equal(run.banked, left)
  while (run.status === 'cleared') run.take(run.offers[0].id)
  assert.equal(run.ballsLeft, ballsFor(run.floor, run.loadout) + left,
    'banked balls did not ride along')
  assert.equal(run.banked, 0, 'the bank was not emptied on arrival')
})

test('pushing on is just continuing to score, and the quota only announces once', () => {
  const run = new Run(cab, 9)
  toQuota(run)
  run.drain()
  const at = run.floorScore
  run.observe([{ type: 'bucket', value: 1, x: 0.1, y: 0.3, site: 'westLow' }], 0.001,
    { inFlight: 1 })
  assert.ok(run.floorScore > at, 'surplus scored nothing')
  assert.equal(run.status, 'playing')
  assert.ok(!run.drain().some(e => e.type === 'quotaMet'),
    'the quota announced itself again — it must only speak once per floor')
})

test('pushing on until the tray is empty clears the floor, it does not fail the run', () => {
  const run = new Run(cab, 9)
  toQuota(run)
  run.ballsLeft = 0
  run.observe([], 0.016, { inFlight: 0 })
  assert.equal(run.status, 'cleared',
    'spending everything on a floor you had already won ended the run')
  assert.equal(run.banked, 0)
})

test('surplus buys parts by doubling, and the ceiling holds', () => {
  const run = new Run(cab, 9)
  run.quota = 1000
  run.floorScore = 999
  assert.equal(run.surplusPicks(), 0, 'a part was bought before the quota was even met')
  run.floorScore = 2000
  assert.equal(run.surplusPicks(), 1)
  run.floorScore = 4000
  assert.equal(run.surplusPicks(), 2)
  run.floorScore = 8000
  assert.equal(run.surplusPicks(), 3)
  run.floorScore = 8000000
  assert.equal(run.surplusPicks(), MAX_SURPLUS_PICKS, 'the surplus ceiling leaked')
  assert.equal(run.picksEarned(), picksFor(run.floor) + MAX_SURPLUS_PICKS)
})

test('the base pick count is untouched by the surplus rule', () => {
  // picksFor is what the difficulty curve was measured against. Surplus picks
  // are strictly ON TOP; if they ever replace the base, the crossover moves.
  const run = new Run(cab, 9)
  toQuota(run)
  run.bank()
  assert.equal(run.picksLeft, picksFor(1) + run.surplusPicks())
  assert.ok(run.picksLeft >= picksFor(1))
})

test('unspent balls are worth balls OR score, never both', () => {
  // The old leftover bonus paid score for balls that were also carried
  // forward, which meant there was no trade — the number went up either way.
  const run = new Run(cab, 9)
  toQuota(run)
  run.bank()
  const evs = run.drain()
  assert.ok(evs.some(e => e.type === 'floorCleared'))
  assert.ok(!evs.some(e => e.type === 'leftoverBonus'),
    'banked balls were also paid as score — that is not a trade-off, it is a bonus')
})

test('taking a part deals again until the floor s picks are used up', () => {
  const run = new Run(cab, 12)
  // Floor 6 deals three. Walk there first.
  for (let i = 0; i < 5; i++) {
    clearFloor(run)
    while (run.status === 'cleared') run.take(run.offers[0].id)
  }
  clearFloor(run)
  const want = run.picksLeft
  assert.ok(want >= picksFor(run.floor - 0))
  let dealt = 0
  while (run.status === 'cleared') { dealt++; run.take(run.offers[0].id) }
  assert.equal(dealt, want, `floor ${run.floor - 1} dealt ${dealt} times, wanted ${want}`)
})

test('declining forfeits the whole floor, so skip is not a free re-roll', () => {
  const run = new Run(cab, 13)
  for (let i = 0; i < 5; i++) {
    clearFloor(run)
    while (run.status === 'cleared') run.take(run.offers[0].id)
  }
  clearFloor(run)
  assert.ok(run.picksLeft > 1, 'this floor should deal more than once')
  const before = run.loadout.parts.length
  run.skip()
  assert.equal(run.status, 'playing')
  assert.equal(run.loadout.parts.length, before)
})

test('clearing twelve floors banks the win and the floors keep coming', () => {
  const run = new Run(cab, 21)
  let wins = 0
  for (let i = 0; i < FLOORS + 3; i++) {
    clearFloor(run)
    for (const e of run.drain()) if (e.type === 'runWon') wins++
    while (run.status === 'cleared') run.take(run.offers[0].id)
  }
  assert.equal(wins, 1, 'the win was banked more than once, or never')
  assert.ok(run.cleared)
  assert.ok(run.floor > FLOORS, 'the run stopped at the good bit')
  assert.equal(run.status, 'playing')
})

// ── the cabinets ────────────────────────────────────────────────────────────

test('exactly one cabinet is available to a new player', () => {
  const meta = newMeta()
  const open = CABINET_ORDER.filter(k => isUnlocked(CABINETS[k], meta))
  assert.deepEqual(open, ['floor'])
})

test('every cabinet builds a legal board from its starting parts', () => {
  for (const key of CABINET_ORDER) {
    const L = resolveLoadout(CABINETS[key].parts || [])
    const built = buildBoard(L)
    assert.ok(built.parts.buckets.length >= 2, `${key} starts with too few buckets`)
    assert.ok(built.world.nails.length > 40, `${key} lost its nail field`)
  }
})

test('a run records into the meta, and unlocks are monotone', () => {
  const meta = newMeta()
  const run = new Run(cab, 31)
  run.score = 400000
  run.floor = 7
  run.cleared = true
  const gained = recordRun(meta, run)
  assert.equal(meta.wins, 1)
  assert.equal(meta.bestFloor, 7)
  assert.equal(meta.lifetimeScore, 400000)
  assert.ok(gained.includes('ippatsu'), 'reaching floor 7 did not unlock the floor-4 cabinet')
  // Unlocking never goes backwards, however badly the next run goes.
  const open = CABINET_ORDER.filter(k => isUnlocked(CABINETS[k], meta))
  const bad = new Run(cab, 32)
  bad.score = 0; bad.floor = 1
  recordRun(meta, bad)
  for (const k of open) assert.ok(isUnlocked(CABINETS[k], meta), `${k} re-locked itself`)
})

// ── the base values ─────────────────────────────────────────────────────────

// ── the keystone's socket must not rot ──────────────────────────────────────
//
// `SCORE_ORIGIN` is a falsifiable claim about where a score came from, and
// `run.provenance` is what will one day let an instrument check it
// (docs/HANDOFF.md — where the score came from). A scoring source added later
// without a classification would be invisible to that instrument, which is the
// quiet way a measurement stops measuring everything — exactly the failure
// Builder 2's cue-family test was written against.

test('every scoring source declares an origin', () => {
  for (const kind of Object.keys(SCORE)) {
    assert.ok(SCORE_ORIGIN[kind],
      `SCORE.${kind} has no entry in SCORE_ORIGIN — it would be counted as "aimed" by default`)
    assert.ok(['aimed', 'lottery'].includes(SCORE_ORIGIN[kind]),
      `SCORE_ORIGIN.${kind} is "${SCORE_ORIGIN[kind]}", which is not an origin`)
  }
  for (const kind of Object.keys(SCORE_ORIGIN)) {
    assert.ok(SCORE[kind] !== undefined,
      `SCORE_ORIGIN declares "${kind}", which is not a scoring source`)
  }
})

test('the provenance ledger accounts for every point, exactly', () => {
  const run = new Run(cab, 77)
  run.quota = Infinity                     // never stop; we want a long tail
  const kinds = Object.keys(SCORE)
  for (let i = 0; i < 400; i++) {
    const kind = kinds[i % kinds.length]
    run.add(SCORE[kind], kind, 0.2, 0.3)
    if (i % 17 === 0) run.observe([], run.loadout.comboWindow + 0.1, { inFlight: 1 })
  }
  const P = run.provenance
  const bySource = Object.values(P.bySource).reduce((a, b) => a + b, 0)
  assert.equal(bySource, run.score, 'the per-source split does not sum to the score')
  assert.equal(P.byOrigin.aimed + P.byOrigin.lottery, run.score,
    'the aimed/lottery split does not sum to the score')
  assert.equal(P.base + P.fromChain, run.score,
    'base + fromChain must equal the score exactly, not approximately')
  assert.ok(P.fromChain > 0, 'no score was attributed to the chain across 400 events')
  assert.ok(P.byOrigin.aimed > 0 && P.byOrigin.lottery > 0)
})

test('the provenance ledger is read by nothing', () => {
  // The keystone contract: declared, wired, consumed by nothing. If a future
  // builder wires a consumer, they should delete this test on purpose rather
  // than discover it failing.
  const a = new Run(cab, 78)
  const b = new Run(cab, 78)
  // Corrupt one ledger beyond all recognition, then play both identically.
  b.provenance.byOrigin.lottery = 999999
  b.provenance.bySource.nonsense = -12345
  b.provenance.base = NaN
  for (let i = 0; i < 30; i++) {
    for (const r of [a, b]) r.add(SCORE.bucket, 'bucket', 0.1, 0.3)
  }
  assert.equal(a.score, b.score, 'the provenance ledger fed back into scoring')
  assert.equal(a.status, b.status)
  assert.equal(a.chain, b.chain)
  assert.equal(a.ballsLeft, b.ballsLeft)
})

// ── the record ──────────────────────────────────────────────────────────────

/** A finished-run stub, since recordRun only reads a handful of fields. */
const finished = (score, floor, cabKey = 'floor', cleared = false, chain = 0) => ({
  score, floor, cleared, bestChain: chain,
  cabinet: CABINETS[cabKey], loadout: { parts: ['bucket', 'mult'] }
})

test('the record table keeps the best runs, in order, and bounded', () => {
  const meta = newMeta()
  for (let i = 1; i <= RUNS_KEPT + 8; i++) recordRun(meta, finished(i * 100, i), 1000 + i)
  assert.equal(meta.records.length, RUNS_KEPT, 'the table grew without bound')
  for (let i = 1; i < meta.records.length; i++) {
    assert.ok(meta.records[i - 1].score >= meta.records[i].score, 'the table is not sorted')
  }
  assert.equal(meta.records[0].score, (RUNS_KEPT + 8) * 100)
  assert.equal(meta.runs, RUNS_KEPT + 8, 'the run COUNT must not be capped with the table')
})

test('a record carries enough context to be worth beating', () => {
  const meta = newMeta()
  recordRun(meta, finished(5000, 7, 'uramono', true, 42), 123456)
  const r = meta.records[0]
  assert.equal(r.cab, 'uramono')
  assert.equal(r.floor, 7)
  assert.equal(r.cleared, true)
  assert.equal(r.chain, 42)
  assert.equal(r.parts, 2)
  assert.equal(r.at, 123456)
})

test('per-cabinet bests are kept apart', () => {
  // A score on the stock machine and one on URAMONO are not the same claim —
  // the quota multiplier alone is 2.1×.
  const meta = newMeta()
  recordRun(meta, finished(9000, 5, 'floor'))
  recordRun(meta, finished(3000, 3, 'uramono'))
  assert.equal(meta.perCab.floor.best, 9000)
  assert.equal(meta.perCab.uramono.best, 3000)
  assert.equal(meta.perCab.floor.runs, 1)
  assert.ok(!meta.perCab.hanemono, 'a cabinet never played got a record anyway')
})

test('the record survives a save round-trip', () => {
  // It lives in localStorage as JSON, so anything that cannot survive
  // JSON.stringify is not really persisted however correct it looks in memory.
  const meta = newMeta()
  recordRun(meta, finished(4242, 9, 'kenri', true, 17), 999)
  const back = JSON.parse(JSON.stringify(meta))
  assert.deepEqual(back.records, meta.records)
  assert.deepEqual(back.perCab, meta.perCab)
  assert.equal(back.bestChain, 17)
})

test('a bucket outscores a start-pocket entry', () => {
  // The project's own argument, applied to the scoreboard: an honest prize is
  // worth more than a lottery ticket wearing a prize's clothing.
  assert.ok(SCORE.bucket > SCORE.heso)
  for (const [k, v] of Object.entries(SCORE)) {
    assert.ok(Number.isFinite(v) && v > 0, `SCORE.${k} is not a positive number`)
  }
})
