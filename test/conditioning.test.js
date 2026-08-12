import test from 'node:test'
import assert from 'node:assert/strict'
import { ConditioningLedger, formatConditioningSummary } from '../src/audio/conditioning.js'

test('same-frame pay-before-cue ordering still backs a reward cue', () => {
  const c = new ConditioningLedger()
  c.pay({ t: 1, n: 3, source: 'heso' })
  c.cue({ t: 1, name: 'heso', family: 'reward' })
  const s = c.summary(2)
  assert.equal(s.reward.count, 1)
  assert.equal(s.reward.hits, 1)
  assert.equal(s.reward.rate, 1)
})

test('an unbacked reward cue is exposed, not averaged away', () => {
  const c = new ConditioningLedger()
  c.cue({ t: 1, name: 'cascade', family: 'reward' })
  c.advance(2)
  const s = c.summary(2)
  assert.equal(s.reward.rate, 0)
})

test('mechanism contingency is measured against the session base rate', () => {
  const c = new ConditioningLedger()
  c.cue({ t: 1, name: 'impact', family: 'mechanism' })
  c.pay({ t: 1.2, n: 1, source: 'bucket' })
  for (const t of [3, 5, 7, 9]) c.cue({ t, name: 'impact', family: 'mechanism' })
  c.advance(10)
  const s = c.summary(10)
  assert.equal(s.mechanism.count, 5)
  assert.equal(s.mechanism.hits, 1)
  assert.ok(s.baseP > 0 && s.baseP < 0.1)
  assert.ok(s.mechanism.delta > 0, 'the deliberately correlated mechanism was not exposed')
})

test('predictive cues get their measured five-second horizon', () => {
  const c = new ConditioningLedger()
  c.cue({ t: 2, name: 'warp', family: 'predictive' })
  c.pay({ t: 6.5, n: 3, source: 'heso' })
  const s = c.summary(7)
  assert.equal(s.predictive.hits, 1)
  assert.ok(s.predictive.baseP > s.mechanism.baseP,
    'the five-second prediction was compared to the 400 ms mechanism base')
  assert.equal(s.predictive.delta, s.predictive.rate - s.predictive.baseP)
})

test('each cue delta uses the base chance from its own horizon', () => {
  const c = new ConditioningLedger()
  c.cue({ t: 1.5, name: 'warp', family: 'predictive' })
  c.cue({ t: 5.8, name: 'impact', family: 'mechanism' })
  c.pay({ t: 6, n: 3, source: 'heso' })
  const s = c.summary(10)
  assert.equal(s.predictive.baseP, 0.5)
  assert.ok(Math.abs(s.mechanism.baseP - 0.04) < 1e-12)
  assert.equal(s.byName.find(r => r.name === 'warp').delta, 0.5)
  assert.equal(s.byName.find(r => r.name === 'impact').delta, 0.96)
})

test('a silent session reports no observations instead of invented percentages', () => {
  const c = new ConditioningLedger()
  c.pay({ t: 2, n: 3, source: 'heso' })
  const s = c.summary(10)
  const words = formatConditioningSummary(s)
  assert.equal(s.reward.rate, null)
  assert.equal(s.predictive.delta, null)
  assert.equal(s.mechanism.delta, null)
  for (const word of Object.values(words)) {
    assert.match(word, /^No audible/)
    assert.doesNotMatch(word, /%|0\/0/)
  }
})
