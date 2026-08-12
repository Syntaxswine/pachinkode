import test from 'node:test'
import assert from 'node:assert/strict'
import { Machine } from '../src/sim/machine.js'
import { Dopamine, bernoulliUncertainty } from '../src/sim/dopamine.js'
import { BOARD } from '../src/sim/board.js'

test('settle returns prediction error, not the raw reward', () => {
  const dop = new Dopamine(BOARD.w, BOARD.h)
  const a = { id: 1, x: 0.22, y: 0.31 }
  dop.visit(a)
  assert.equal(dop.settle(a, 14), 14)

  const b = { id: 2, x: a.x, y: a.y }
  dop.visit(b)
  const second = dop.settle(b, 14)
  assert.ok(second > 0 && second < 14,
    `learned prediction should reduce the second error, got ${second}`)

  const c = { id: 3, x: a.x, y: a.y }
  dop.visit(c)
  assert.ok(dop.settle(c, 0) < 0, 'an expected reward that drains must be a negative error')
})

test('Bernoulli uncertainty is honest at certainty and maximal at a coin flip', () => {
  assert.equal(bernoulliUncertainty(0), 0)
  assert.equal(bernoulliUncertainty(1), 0)
  assert.equal(bernoulliUncertainty(0.5), 1)
  assert.ok(bernoulliUncertainty(1 / 99) < 0.05,
    'a 1-in-99 spin must not masquerade as high uncertainty')
})

test('reach is not public until the matching reels visibly stop', () => {
  const m = new Machine({ seed: 1 })
  m.spin = {
    t: 0, dur: 1, outcome: false, reach: true, reachRevealed: false,
    ko: false, ds: 123
  }
  m.tickLottery(0.57)
  assert.ok(!m.drain().some(e => e.type === 'reachReveal'),
    'reach leaked before the renderer reveal boundary')
  m.tickLottery(0.02)
  const events = m.drain()
  assert.equal(events.filter(e => e.type === 'reachReveal').length, 1)
  m.tickLottery(0.2)
  assert.ok(!m.drain().some(e => e.type === 'reachReveal'), 'reach revealed twice')
})
