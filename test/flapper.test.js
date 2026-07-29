// The flapper — the hane spec (operator's design: a cabinet with no lottery,
// where the navel works the wings). What must stay true:
import test from 'node:test'
import assert from 'node:assert/strict'

import { Machine, SPECS, chainLength } from '../src/sim/machine.js'
import { DT } from '../src/sim/world.js'
import { makeBall } from '../src/sim/world.js'
import { CABINETS } from '../src/sim/cabinets.js'

test('the flapper has no lottery: a chucker entry buys no ticket, ever', () => {
  const m = new Machine({ seed: 5, spec: 'hane', tokens: 50 })
  m.drain()
  for (let i = 0; i < 6; i++) m.onPocket({ kind: 'chucker', x: 0.22, y: 0.5, ball: makeBall(0.22, 0.5) })
  for (let i = 0; i < 5 * 1200; i++) m.step(DT)
  assert.equal(m.holds, 0, 'a hold was queued — that is a lottery ticket')
  assert.equal(m.spins, 0, 'the reels spun on a machine that has none')
  assert.equal(m.jackpots + m.koataris, 0)
})

test('the navel works the wings: pulses play out as open/shut choreography, then rest', () => {
  const m = new Machine({ seed: 5, spec: 'hane', tokens: 50 })
  m.drain()
  m.onPocket({ kind: 'chucker', x: 0.22, y: 0.5, ball: makeBall(0.22, 0.5) })
  const S = SPECS.hane
  // Mid-first-opening: wings open.
  for (let i = 0; i < Math.floor(S.flapOpen * 0.5 / DT); i++) m.step(DT)
  assert.ok(m.parts.tulips.every(t => t.open), 'wings not open mid-pulse')
  // Run the whole choreography out: all pulses spent, wings shut.
  const total = (S.flapOpen + S.flapShut) * S.flapPulses + 1
  for (let i = 0; i < Math.floor(total / DT); i++) m.step(DT)
  assert.ok(m.parts.tulips.every(t => !t.open), 'wings stuck open after the choreography')
  assert.equal(m.flaps, S.flapPulses, 'wrong number of openings for one entry')
  // The events told the truth: one open and one shut mark per pulse.
  const flaps = m.drain().filter(e => e.type === 'flap')
  assert.equal(flaps.filter(e => e.open).length, S.flapPulses)
  assert.equal(flaps.filter(e => !e.open).length, S.flapPulses)
})

test('rapid entries queue with a cap rather than being swallowed or unbounded', () => {
  const m = new Machine({ seed: 5, spec: 'hane', tokens: 50 })
  for (let i = 0; i < 20; i++) m.onPocket({ kind: 'chucker', x: 0.22, y: 0.5, ball: makeBall(0.22, 0.5) })
  assert.ok(m.flap.queue <= 6, `queue ${m.flap.queue} grew without bound`)
  assert.ok(m.flap.queue > 0)
})

test('the wings are the payout organ: spec tulipPay rides the tulip case', () => {
  const m = new Machine({ seed: 5, spec: 'hane', tokens: 50 })
  m.drain()
  const won0 = m.won
  m.onPocket({ kind: 'tulip', x: 0.14, y: 0.14, ball: makeBall(0.14, 0.14) })
  assert.equal(m.won - won0, SPECS.hane.tulipPay)
})

test('the taxonomy holds: chainLength refuses the flapper, HANEMONO carries the hane spec', () => {
  assert.equal(chainLength(SPECS.hane), 1)
  assert.equal(CABINETS.hanemono.spec, 'hane')
  assert.ok(CABINETS.hanemono.parts.filter(p => p === 'bucket').length >= 3, 'the extra buckets are the point')
})
