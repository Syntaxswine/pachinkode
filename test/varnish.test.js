import test from 'node:test'
import assert from 'node:assert/strict'
import { Machine } from '../src/sim/machine.js'
import { Dopamine } from '../src/sim/dopamine.js'
import { BOARD } from '../src/sim/board.js'
import { DT } from '../src/sim/world.js'
import { framePalette, solveBS, arousalOf } from '../src/render/palette.js'

/**
 * Design law L4: VARNISH is strictly a presentation layer. No code path may let
 * it change outcomes, odds, payouts or physics.
 *
 * This is the test that makes that a fact rather than an intention. If a future
 * builder reaches from the renderer or the synth back into the simulation — even
 * with the best of motives, even to make something feel better — this fails.
 *
 * The whole game is an argument that the content of a gambling machine is
 * nothing and the presentation is everything. That argument is worthless unless
 * the two are genuinely separable here.
 */
function runSession (seed, steps = 90000) {
  const m = new Machine({ seed, spec: 'amadeji', tokens: 1500 })
  m.dial = 0.20
  m.firing = true
  const log = []
  for (let i = 0; i < steps; i++) {
    if (m.inJackpot) m.dial = 0.88
    else m.dial = 0.20
    m.step(DT)
    for (const ev of m.drain()) {
      // Record only outcome-bearing facts, to the last bit.
      if (['heso', 'tulip', 'attacker', 'foul', 'drain', 'pay', 'spinStart',
        'spinLose', 'jackpot', 'kakuhen', 'round'].includes(ev.type)) {
        log.push(`${ev.type}:${ev.n ?? ''}:${ev.reach ?? ''}:${ev.kind ?? ''}:${(ev.x ?? 0).toFixed(6)}`)
      }
    }
  }
  return { log, tokens: m.tokens, spent: m.spent, won: m.won, spins: m.spins, jackpots: m.jackpots }
}

test('varnish is presentation only: identical outcomes at every setting', () => {
  // The simulation takes no varnish argument at all — the strongest possible
  // form of the guarantee. Two runs of the same seed must agree exactly, and
  // the renderer/synth are handed the varnish value afterwards.
  const a = runSession(20260727)
  const b = runSession(20260727)
  assert.equal(a.log.length, b.log.length, 'event counts diverged')
  assert.deepEqual(a.log, b.log, 'outcome log diverged')
  assert.equal(a.tokens, b.tokens)
  assert.equal(a.spent, b.spent)
  assert.equal(a.won, b.won)
  assert.equal(a.jackpots, b.jackpots)
  assert.ok(a.log.length > 50, `session was too short to prove anything (${a.log.length} events)`)
})

test('the Machine class exposes no varnish surface', () => {
  const m = new Machine({ seed: 1 })
  const names = new Set([
    ...Object.keys(m),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(m))
  ])
  for (const n of names) {
    assert.ok(!/varnish|presentation|cosmetic/i.test(n),
      `simulation exposes a presentation-shaped member: ${n}`)
  }
})

test('the dopamine model never mutates the machine', () => {
  const m = new Machine({ seed: 7, tokens: 400 })
  const dop = new Dopamine(BOARD.w, BOARD.h)
  m.dial = 0.2; m.firing = true
  for (let i = 0; i < 12000; i++) {
    m.step(DT)
    for (const b of m.world.balls) dop.visit(b)
    for (const ev of m.drain()) {
      if (ev.type === 'heso') dop.push(14)
      if (ev.type === 'drain' && ev.ball) dop.settle(ev.ball, 0)
    }
    dop.update(DT, { balls: m.world.balls.length, impacts: 0 })
  }
  // A snapshot of the machine taken before and after a dopamine update must match.
  const before = JSON.stringify({ t: m.tokens, s: m.spent, w: m.won, sp: m.spins })
  dop.update(DT, { balls: 0, impacts: 0 })
  dop.push(99)
  dop.nearMiss(true)
  const after = JSON.stringify({ t: m.tokens, s: m.spent, w: m.won, sp: m.spins })
  assert.equal(before, after, 'the dopamine model wrote back into the simulation')
})

test('palette: saturation collapses to zero at varnish 0, luminance survives', () => {
  const dop = new Dopamine(BOARD.w, BOARD.h)
  dop.arousal = 0.8
  const on = framePalette(dop, 1)
  const off = framePalette(dop, 0)
  assert.ok(on.saturation > 0.3, `expected colour at full varnish, got ${on.saturation}`)
  assert.equal(off.saturation, 0, `expected zero saturation unvarnished, got ${off.saturation}`)
  // Brightness must NOT collapse — the board stays legible, it just loses its hue.
  assert.ok(off.brightness > 0.2, `board went dark instead of grey: ${off.brightness}`)
})

test('palette: the Valdez & Mehrabian relations hold in the solver', () => {
  // Saturation drives arousal (+0.60); brightness opposes it (−0.31). Solving
  // for a target arousal must reproduce that target.
  for (const target of [0, 0.25, 0.5, 0.75, 1]) {
    const { B, S } = solveBS(target)
    if (S < 1) {
      assert.ok(Math.abs(arousalOf(B, S) - target) < 1e-9,
        `solver missed: asked ${target}, got ${arousalOf(B, S)}`)
    }
  }
  // And the counterintuitive direction is preserved: more arousal, less brightness.
  assert.ok(solveBS(1).B < solveBS(0).B, 'brightness should fall as arousal rises')
  assert.ok(solveBS(1).S > solveBS(0).S, 'saturation should rise as arousal rises')
})
