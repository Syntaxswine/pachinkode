import test from 'node:test'
import assert from 'node:assert/strict'

import { Run, quotaFor, picksFor, ballsFor, BALLS_BASE, chainMult, SCORE, FLOORS, QUOTA_BASE, QUOTA_GROWTH, MAX_SURPLUS_PICKS, SCORE_ORIGIN, FLOOR1_EASE, SHOP, sandboxCabinet, QUOTA_TOP, EFFECTIVE_GROWTH, DENOM_GROWTH, denomFor } from '../src/sim/run.js'
import {
  baseLoadout, resolveLoadout, drawOffers, partAvailable, countPart,
  PARTS, PART_BY_ID, BUCKET_SITES, SITE_ORDER, BUCKET_MOUTH_MAX
} from '../src/sim/loadout.js'
import { CABINETS, CABINET_ORDER, isUnlocked, newMeta, recordRun, RUNS_KEPT } from '../src/sim/cabinets.js'
import { buildBoard, makeBall } from '../src/sim/board.js'
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
  // From floor 2 on. Floor 1 is the eased on-ramp (FLOOR1_EASE) and sits
  // BELOW the curve on purpose — the geometric law owns floors 2+, where the
  // crunch lives, and the 1→2 step is deliberately the biggest in the game.
  let prev = 0
  for (let f = 1; f <= FLOORS + 8; f++) {
    const q = quotaFor(f, null, 1)
    assert.ok(q > prev, `floor ${f} asks for less than floor ${f - 1}`)
    if (f > 2) {
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
  // Floor 1 prints NO price — the on-ramp pays one part and sells nothing
  // more, and a price for a part that cannot arrive is a lie (see nextPickAt).
  assert.equal(ev.nextPickAt, null)
})

test('from floor 2, the next part is a stated price on the quotaMet event', () => {
  const run = new Run(cab, 9)
  clearFloor(run)
  while (run.status === 'cleared') run.take(run.offers[0].id)
  run.drain()
  toQuota(run)
  const ev = run.drain().find(e => e.type === 'quotaMet')
  assert.ok(ev, 'no quotaMet on floor 2')
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

// ── the lottery's lesser verdicts (operator's rulings) ──────────────────────

test('a straight scores between a bucket and the small win, from the lottery', () => {
  assert.ok(SCORE.sequence > SCORE.bucket && SCORE.sequence < SCORE.koatari,
    'the operator’s band: more than a bucket, not a jackpot')
  assert.equal(SCORE_ORIGIN.sequence, 'lottery',
    'three digits you never touched came out in a row — that is the RNG’s credit')
  const run = new Run(cab, 9)
  const before = run.score
  run.observe([{ type: 'sequence', syms: [3, 4, 5], dir: 'up' }], 0.001, { inFlight: 1 })
  assert.ok(run.score >= before + SCORE.sequence, 'the straight scored nothing')
})

test('straights announce both ways round the wrap; total misses pay the lowest digit', () => {
  const m = new Machine({ seed: 3, tokens: 100 })
  m.drain()
  m.lastResolve = { kind: 'lose', at: 0 }
  m.resolveMiss([3, 4, 5], false)
  let evs = m.drain()
  assert.ok(evs.some(e => e.type === 'sequence'), 'no sequence event for 3-4-5')
  const pay = evs.find(e => e.type === 'pay')
  assert.ok(pay && pay.n === 3 && pay.source === 'hazure',
    'a total miss must pay the lowest of the three digits')
  // Descending through the wrap — and carrying a zero, which pays nothing.
  m.lastResolve = { kind: 'lose', at: 0 }
  m.resolveMiss([1, 0, 7], false)
  evs = m.drain()
  assert.ok(evs.some(e => e.type === 'sequence'), '1-0-7 descending wrap missed')
  assert.ok(!evs.some(e => e.type === 'pay'), 'a zero on the display paid')
  // A reach is never consoled; nor is a pair — total means total.
  m.lastResolve = { kind: 'lose', at: 0 }
  m.resolveMiss([2, 5, 2], true)
  assert.ok(!m.drain().some(e => e.type === 'pay'), 'a reach was consoled')
  m.lastResolve = { kind: 'lose', at: 0 }
  m.resolveMiss([4, 4, 6], false)
  assert.ok(!m.drain().some(e => e.type === 'pay'), 'a pair was consoled')
})

// ── the gold ball ───────────────────────────────────────────────────────────

test('the gold ball is catalogued rare, capped at one, and sets the flag', () => {
  const p = PART_BY_ID.goldball
  assert.ok(p, 'no goldball part')
  assert.equal(p.max, 1)
  assert.ok(p.weight <= 6, 'GOLD BALLS must stay rare — it is overpowered by ruling')
  assert.equal(resolveLoadout(['goldball']).goldBalls, true)
  assert.equal(baseLoadout().goldBalls, false)
})

test('a gold ball splits once at its first nail into two silver balls, opposite ways', () => {
  const { world } = buildBoard(baseLoadout())
  const nail = world.nails[Math.floor(world.nails.length / 2)]
  world.spawn(makeBall(nail.x + 0.0002, nail.y - 0.02, 0, 0.4, { gold: true }))
  let split = null
  const all = []
  for (let i = 0; i < 1200 && !split; i++) {
    world.step()
    for (const ev of world.drainEvents()) { all.push(ev); if (ev.type === 'split') split = ev }
  }
  assert.ok(split, 'the gold ball never split (dropped square onto a nail)')
  assert.equal(world.balls.length, 2, 'one ball did not become two')
  const [a, b] = world.balls
  assert.ok(!a.gold && !b.gold, 'a twin stayed gold — the split must be once, ever')
  assert.ok(a.vx * b.vx <= 0, 'the twins left in the same direction')
  assert.equal(all.filter(e => e.type === 'split').length, 1, 'more than one split from one ball')
})

// ── review pins: the second adversarial pass, 2026-07-28 ────────────────────

test('a split twin fouling back is a drain, never a refund', () => {
  // A twin was BORN in play — its launch is still on the field as its
  // sibling. Refunding it paid one launch twice while half of it kept
  // scoring (measured: 15 phantom refunds per 1,500 launches).
  const m = new Machine({ seed: 3, tokens: 100 })
  m.drain()
  const twin = makeBall(0.1, 0.3, 0, 0, { split: true })
  const played = makeBall(0.1, 0.3, 0, 0); played.hits = 4
  const fresh = makeBall(0.1, 0.3, 0, 0)
  const spent0 = m.spent
  m.onPocket({ kind: 'foul', x: 0.1, y: 0.39, ball: twin })
  m.onPocket({ kind: 'foul', x: 0.1, y: 0.39, ball: played })
  const evs1 = m.drain()
  assert.ok(!evs1.some(e => e.type === 'foul'), 'a played ball was refunded as a foul')
  assert.ok(evs1.filter(e => e.type === 'drain').length === 2)
  assert.equal(m.spent, spent0, 'the ledger refunded a launch that is still in play')
  m.onPocket({ kind: 'foul', x: 0.1, y: 0.39, ball: fresh })
  assert.ok(m.drain().some(e => e.type === 'foul'), 'a genuine weak shot lost its refund')
})

test('the reels draw a display seed — a paying display may not run on a counter schedule', () => {
  // With a pure spin-counter hash, straights and consolations were
  // seed-independent and precomputable from the HUD's own counter. Two
  // machines on different seeds must not show identical loss displays
  // spin-for-spin.
  const symsOf = (seed, n) => {
    const m = new Machine({ seed, tokens: 50 })
    const out = []
    for (let i = 0; i < n; i++) {
      m.spin = { t: 0, dur: 1, outcome: false, reach: false, ko: false,
        ds: (m.rng() * 4294967296) >>> 0 }
      out.push(m.spinSymbols().join(''))
      m.spin = null; m.spins++
    }
    return out.join('|')
  }
  assert.notEqual(symsOf(11, 40), symsOf(29, 40),
    'two seeds produced identical display streams — the schedule is back')
})

test('the shop shelf keeps between visits; only buying re-deals', () => {
  const run = sbx()
  sbxScore(run, QUOTA_BASE * 4)
  run.shopDeal()
  const shelf = run.offers.map(o => o.id).join('|')
  // Door-toggling must not reroll: the shell deals only when offers is null.
  // (The shell-side guard is `if (!run.offers) run.shopDeal()`; at the run
  // layer the property to pin is that nothing but deal/buy touches offers.)
  assert.equal(run.offers.map(o => o.id).join('|'), shelf)
  run.buy(run.offers[0].id)
  assert.ok(run.offers.length === 3, 'buying must re-deal — that is the paid reroll')
})

test('the keystone identity, amended for the wallet: base + fromChain === score + spent', () => {
  const run = sbx()
  sbxScore(run, QUOTA_BASE * 2)
  run.shopDeal()
  run.buy(run.offers[0].id)
  const P = run.provenance
  assert.equal(P.base + P.fromChain, run.score + run.spent,
    'spending broke the earned-points ledger — provenance records EARNED, spent moves score aside')
  const srcSum = Object.values(P.bySource).reduce((a, b) => a + b, 0)
  assert.equal(srcSum, run.score + run.spent)
  assert.equal(P.byOrigin.aimed + P.byOrigin.lottery, run.score + run.spent)
})

test('the consolation pays the run’s CLOCK — the one payout that does', () => {
  const run = new Run(cab, 9)
  const balls0 = run.ballsLeft
  run.observe([{ type: 'pay', n: 3, source: 'hazure' }], 0.001, { inFlight: 1 })
  assert.equal(run.ballsLeft, balls0 + 3,
    'the consolation was confiscated — a printed payout nobody could receive')
  // And an ordinary pocket payout still does NOT touch the clock at stock.
  run.observe([{ type: 'pay', n: 3, source: 'heso' }], 0.001, { inFlight: 1 })
  assert.equal(run.ballsLeft, balls0 + 3, 'a pocket payout leaked into the clock')
})

test('a paid miss carries its consolation on the loss event, for the honest voices', () => {
  const m = new Machine({ seed: 3, tokens: 100 })
  m.drain()
  m.lastResolve = { kind: 'lose', at: 0 }
  const paid = m.resolveMiss([3, 5, 1], false)
  assert.equal(paid, 1, 'resolveMiss must report what it paid so spinLose can carry it')
  m.lastResolve = { kind: 'lose', at: 0 }
  assert.equal(m.resolveMiss([4, 4, 6], false), 0)
})

// ── the on-ramp: floor 1 is easy, and pays exactly one part ─────────────────

test('floor 1 is eased and floors 2+ are untouched by the ease', () => {
  const L = baseLoadout()
  assert.equal(quotaFor(1, L, 1), Math.round(QUOTA_BASE * FLOOR1_EASE))
  assert.equal(quotaFor(2, L, 1), Math.round(QUOTA_BASE * QUOTA_GROWTH),
    'the ease leaked past the on-ramp — the crunch moved')
})

test('floor 1 pays one part with no surplus, at any overshoot', () => {
  const run = new Run(cab, 9)
  toQuota(run)
  run.floorScore = run.quota * 64      // eight-times-doubled — 3 picks anywhere else
  assert.equal(run.surplusPicks(), 0, 'floor 1 sold a surplus part')
  assert.equal(run.picksEarned(), 1)
  assert.equal(run.nextPickAt(), null,
    'floor 1 printed a price for a part that can never arrive — the instrument caught the ' +
    'auto-player chasing that phantom and carrying less into floor 2')
})

// ── the sandbox: free play's score is a wallet ──────────────────────────────

const sbx = () => new Run(sandboxCabinet('amadeji'), 5)
const sbxScore = (run, n) => {
  while (run.score < n) {
    run.observe([{ type: 'bucket', value: 1, x: 0.1, y: 0.3, site: 'westLow' }], 0.001,
      { inFlight: 1 })
  }
}

test('the sandbox never meets a quota and never fails', () => {
  const run = sbx()
  sbxScore(run, 50000)
  assert.equal(run.metQuota, false, 'a quota of zero "met" on the first point')
  assert.equal(run.status, 'playing')
  run.ballsLeft = 0
  run.observe([], 0.016, { inFlight: 0 })
  assert.equal(run.status, 'playing', 'the sandbox ended — it must not have an ending')
  assert.equal(run.bank(), false, 'the sandbox banked — there is no next floor')
})

test('the shop sells a part, deducts the price, and escalates by the effective ratio', () => {
  const run = sbx()
  sbxScore(run, QUOTA_BASE * 3)
  const wallet = run.score
  const price0 = run.partPrice
  assert.equal(price0, QUOTA_BASE,
    'the first part must cost QUOTA_BASE — the curve’s anchor, not the eased on-ramp quota')
  run.shopDeal()
  assert.ok(run.buy(run.offers[0].id))
  assert.equal(run.score, wallet - price0, 'the wallet did not pay')
  assert.equal(run.spent, price0)
  assert.equal(run.loadout.parts.length, 1, 'paid and not fitted')
  assert.equal(run.partPrice, Math.round(QUOTA_BASE * EFFECTIVE_GROWTH),
    'the price did not climb by the EFFECTIVE ratio — the sandbox has no denomination')
  assert.ok(run.offers && run.offers.length === 3, 'the shelf was not re-dealt')
})

test('the denomination: floor 12 demands exactly one billion, and the fight underneath never moved', () => {
  // The summit is the operator's stated number, to the point.
  assert.equal(quotaFor(FLOORS, null, 1), QUOTA_TOP,
    'floor 12 must demand exactly 1,000,000,000')
  // The EFFECTIVE wall — quota divided by the floor's denomination — is the
  // old measured curve, byte-for-byte in ratio: 3,700 × 1.30^(floor−1).
  for (let f = 2; f <= FLOORS + 6; f++) {
    const eff = quotaFor(f, null, 1) / denomFor(f)
    const old = QUOTA_BASE * Math.pow(EFFECTIVE_GROWTH, f - 1)
    // quotaFor rounds to whole points; a half-point of rounding on floor 2's
    // ~4,810 is 1e-4 of relative drift, so that is the bar, not exactness.
    assert.ok(Math.abs(eff / old - 1) < 1e-4, `floor ${f} effective quota drifted: ${eff} vs ${old}`)
  }
  // Floor 1 pays face value; the sandbox always does.
  assert.equal(denomFor(1), 1)
})

test('the denomination scales the score and the keystone identity survives it', () => {
  const run = new Run({ key: 't', label: 't', spec: 'digi', difficulty: 1, parts: [] })
  run.floor = 5
  const n = run.add(SCORE.bucket, 'bucket')
  assert.equal(n, Math.round(SCORE.bucket * run.loadout.bucketScore * run.loadout.scoreMult *
    denomFor(5) * chainMult(1, run.loadout)), 'floor 5 must pay at floor 5 denomination')
  for (let i = 0; i < 40; i++) run.add(SCORE.heso, 'heso')
  const P = run.provenance
  assert.equal(P.base + P.fromChain, run.score, 'base + fromChain !== score at depth')
})

test('the shop refuses a poor wallet and a non-sandbox run', () => {
  const run = sbx()
  run.shopDeal()
  assert.equal(run.buy(run.offers[0].id), false, 'sold on credit')
  assert.equal(run.buyBalls(), false)
  assert.equal(run.loadout.parts.length, 0)
  const real = new Run(cab, 9)
  assert.equal(real.shopDeal(), null, 'a real run opened the shop')
  assert.equal(real.buyBalls(), false, 'a real run bought balls — the tray is a clock')
})

test('buying balls spends score and emits for the shell; the run never touches a machine', () => {
  const run = sbx()
  sbxScore(run, SHOP.ballPrice + 500)
  const wallet = run.score
  run.drain()
  assert.ok(run.buyBalls())
  assert.equal(run.score, wallet - SHOP.ballPrice)
  const ev = run.drain().find(e => e.type === 'ballsBought')
  assert.ok(ev, 'no ballsBought event for the shell to act on')
  assert.equal(ev.n, SHOP.ballBundle)
})

test('machine.buyTokens books bought balls on their own ledger line, and pays nothing', () => {
  const m = new Machine({ seed: 3, tokens: 100 })
  m.drain()
  m.buyTokens(100)
  assert.equal(m.tokens, 200)
  assert.equal(m.bought, 100)
  assert.equal(m.conjured, 100, 'a purchase was booked as conjured')
  assert.equal(m.won, 0, 'a purchase was booked as won — reward cues would fire on a shop click')
  const evs = m.drain()
  assert.ok(evs.some(e => e.type === 'purchase'))
  assert.ok(!evs.some(e => e.type === 'pay'), 'a purchase emitted pay — the reward hook would hear it')
})

test('machine.refit swaps the brass and keeps the ledger and the lottery', () => {
  const m = new Machine({ seed: 3, tokens: 400 })
  m.spent = 77; m.won = 31; m.holds = 2; m.spins = 12
  const L = resolveLoadout(['bucket', 'widen'])
  assert.ok(m.refit(L))
  assert.equal(m.loadout, L)
  assert.equal(m.spent, 77, 'the ledger reset — a purchase must not launder the session')
  assert.equal(m.won, 31)
  assert.equal(m.holds, 2, 'the pending queue was eaten by the fitter')
  assert.equal(m.spins, 12)
  assert.ok(m.parts.buckets.length > 0, 'the new brass is not on the board')
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
  run.floor = 2                    // floor 1 sells no surplus — see the on-ramp
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
    const cab = CABINETS[key]
    const L = resolveLoadout(cab.parts || [], null, cab.motif || null)
    const built = buildBoard(L)
    assert.ok(built.parts.buckets.length >= 2, `${key} starts with too few buckets`)
    // A motif declares its own nail floor (a contour field is legitimately
    // sparser than the grid); the stock literal stays for stock cabinets.
    const floor = cab.motif ? cab.motif.minNails : 40
    assert.ok(built.world.nails.length > floor, `${key} lost its nail field (${built.world.nails.length} <= ${floor})`)
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

test('the provenance receipt can never feed back into scoring', () => {
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
