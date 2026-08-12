import test from 'node:test'
import assert from 'node:assert/strict'
import { Machine, TULIP_PAY, HESO_PAY } from '../src/sim/machine.js'
import { Dopamine } from '../src/sim/dopamine.js'
import { BOARD } from '../src/sim/board.js'
import { DT } from '../src/sim/world.js'

/**
 * The value map must actually learn.
 *
 * This suite exists because it didn't. Every pocket event was re-emitted without
 * the ball that caused it, so `Dopamine.settle()` looked up a visit set that was
 * not there and returned early. Only reward-zero drains reached the learner, V
 * stayed flat zero across all 550 cells, and every trail rendered at the cold end
 * of the scale forever.
 *
 * Nothing failed. No exception, no warning, no visibly broken frame — just the
 * single image the entire game is built around, quietly not happening. A
 * 1500-ball run reported 40 start-pocket entries and zero learning updates.
 *
 * The lesson is narrow and worth keeping: an emergent visual has no natural
 * failure mode. If it silently does nothing, it looks exactly like a feature
 * that has not warmed up yet. So it needs a test that asserts the emergence.
 */

/** Drive a real machine and feed the dopamine model exactly as main.js does. */
function play (balls, { seed = 3, dial = 0.20 } = {}) {
  const m = new Machine({ seed, spec: 'amadeji', tokens: balls + 50 })
  const dop = new Dopamine(BOARD.w, BOARD.h)
  m.dial = dial
  m.firing = true
  const counts = { heso: 0, hesoWithBall: 0, tulip: 0, settles: 0 }
  let guard = 0

  while (guard < balls * 40000) {
    guard++
    if (m.launched >= balls) m.firing = false
    if (m.inJackpot) m.dial = 0.88; else m.dial = dial
    m.step(DT)
    for (const b of m.world.balls) dop.visit(b)

    for (const ev of m.drain()) {
      switch (ev.type) {
        case 'heso':
          counts.heso++
          if (ev.ball) counts.hesoWithBall++
          dop.push(dop.settle(ev.ball, 14)); counts.settles++
          break
        case 'tulip':
          counts.tulip++
          dop.push(dop.settle(ev.ball, TULIP_PAY)); counts.settles++
          break
        case 'attacker': dop.push(dop.settle(ev.ball, m.S.payPerEntry)); counts.settles++; break
        case 'warp': dop.carry(ev.ball, ev.into); break
        case 'drain':
        case 'foul': dop.push(dop.settle(ev.ball, 0)); counts.settles++; break
      }
    }
    dop.update(DT, { balls: m.world.balls.length, impacts: 0 })
    if (!m.firing && m.world.balls.length === 0 && m.launched >= balls) break
  }
  return { m, dop, counts }
}

test('every pocket event carries the ball that caused it', () => {
  const { counts } = play(1200)
  assert.ok(counts.heso > 5, `too few start-pocket entries to judge (${counts.heso})`)
  assert.equal(counts.hesoWithBall, counts.heso,
    `${counts.heso - counts.hesoWithBall} of ${counts.heso} heso events arrived without a ball`)
})

test('the value map learns a non-trivial landscape', () => {
  const { dop } = play(1500)
  let vmax = 0, nonZero = 0
  for (const v of dop.V) { if (v > vmax) vmax = v; if (Math.abs(v) > 1e-6) nonZero++ }
  assert.ok(vmax > 0.5, `value map never rose above ${vmax.toFixed(4)} — nothing was learned`)
  assert.ok(nonZero > 20, `only ${nonZero} cells hold any value at all`)
})

test('the funnel above the start pocket is worth more than the gutter', () => {
  // This is the bright thread. It is not drawn anywhere — it has to be learned,
  // and if it is not, the trails carry no information and the renderer's central
  // claim is false.
  const { dop } = play(2500)
  const funnel = dop.valueAt(0.220, 0.310)      // just above the life nails
  const gutter = dop.valueAt(0.060, 0.430)      // out by the drain, left side
  assert.ok(funnel > 0, `the approach to the start pocket learned nothing (${funnel.toFixed(3)})`)
  assert.ok(funnel > gutter,
    `the funnel (${funnel.toFixed(3)}) should outvalue the gutter (${gutter.toFixed(3)})`)
})

test('warped balls do not leak their history', () => {
  // A warp destroys the ball and spawns a new one. Without carry(), the original
  // visit set is orphaned forever — 297 of them per 1500 balls, and the warp
  // route can never be learned because its history is thrown away at the door.
  const { dop, m } = play(1200)
  assert.ok(dop.visits.size < 30,
    `${dop.visits.size} orphaned visit sets left after ${m.launched} balls`)
})

test('confidence rises where the machine has actually looked', () => {
  const { dop } = play(1500)
  const seen = dop.confidenceAt(0.220, 0.310)
  const unseen = dop.confidenceAt(0.010, 0.010)   // outside the rail entirely
  assert.ok(seen > 0.5, `no confidence built in the busiest lane (${seen.toFixed(3)})`)
  assert.ok(unseen < 0.1, `confidence appeared where no ball can go (${unseen.toFixed(3)})`)
})
