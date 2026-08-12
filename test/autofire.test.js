import test from 'node:test'
import assert from 'node:assert/strict'
import { Machine, FIRE_RATES } from '../src/sim/machine.js'
import { DT } from '../src/sim/world.js'
import { baseLoadout, PART_BY_ID, partAvailable, resolveLoadout, autoFireInterval } from '../src/sim/loadout.js'

test('AUTO HANDLE is rare, floor-gated, capped, and leaves BASE power alone', () => {
  const p = PART_BY_ID.autofire
  const L = baseLoadout()
  assert.ok(p.weight <= 5, `weight ${p.weight} is not rare`)
  assert.equal(partAvailable(L, p, { floor: 4 }), false)
  assert.equal(partAvailable(L, p, { floor: 5 }), true)
  resolveLoadout(['autofire'], L)
  assert.equal(L.autoFire, true)
  assert.equal(partAvailable(L, p, { floor: 12 }), false)
  assert.equal(autoFireInterval(0.2, L, false), 0.2)
  assert.ok(autoFireInterval(0.2, L, true) < 0.2)
})

function traffic (interval) {
  const m = new Machine({ seed: 712, tokens: 4000, fireInterval: interval })
  m.dial = 0.20
  m.firing = true
  let sum = 0, samples = 0, max = 0
  for (let i = 0; i < 30 / DT; i++) {
    m.step(DT); m.drain()
    if (i * DT > 6) {
      const n = m.world.balls.length
      sum += n; samples++; max = Math.max(max, n)
    }
  }
  return { mean: sum / samples, max }
}

test('AUTO HANDLE creates a measurable late-run density step', () => {
  const L = resolveLoadout(['autofire'])
  const base = FIRE_RATES.arcade.interval
  const manual = traffic(base)
  const auto = traffic(autoFireInterval(base, L, true))
  assert.ok(auto.mean > manual.mean * 1.25,
    `autofire mean ${auto.mean.toFixed(2)} did not materially exceed ${manual.mean.toFixed(2)}`)
  assert.ok(auto.max > manual.max, `autofire max ${auto.max} did not exceed ${manual.max}`)
})
