// The canary is an instrument, and an instrument that has never been seen to
// alarm is a decoration. These tests feed the probes stubbed inputs and pin
// that each one actually annotates — including the BLIND case, because "could
// not parse" reported as silence would be noise shaped like a quiet night.
import test from 'node:test'
import assert from 'node:assert/strict'

import testsProbe from '../tools/canary/probes/10-tests.mjs'
import invariantsProbe from '../tools/canary/probes/20-invariants.mjs'
import curveProbe from '../tools/canary/probes/40-curve.mjs'
import boardsProbe from '../tools/canary/probes/50-boards.mjs'

test('tests probe: a failing suite is annotated with the failing names', async () => {
  const out = 'not ok 3 - the ledger holds\n# pass 109\n# fail 1\n'
  const r = await testsProbe.run({ exec: () => ({ code: 1, out, timedOut: false }) })
  assert.equal(r.metrics.fail, 1)
  assert.ok(r.anomalies.some(a => a.includes('the ledger holds')))
})

test('tests probe: unparseable output is BLINDNESS, not a green suite', async () => {
  const r = await testsProbe.run({ exec: () => ({ code: 0, out: 'garbage', timedOut: false }) })
  assert.ok(r.anomalies.some(a => a.includes('BLIND')))
})

test('curve probe: an unparseable table is BLINDNESS', async () => {
  const r = await curveProbe.run({ depth: 'quick', exec: () => ({ code: 0, out: 'reformatted!', timedOut: false }) })
  assert.ok(r.anomalies.some(a => a.includes('BLIND')))
})

test('curve probe: a sagging on-ramp is flagged against the 85% target', async () => {
  const out = '   floor   quota      reached  cleared   tray spent TO MEET THE QUOTA\n' +
    '      1        1,850        6     67%     46%  ███\n' +
    '      2        4,810        4    100%     99%  ███\n'
  const r = await curveProbe.run({ depth: 'quick', exec: () => ({ code: 0, out, timedOut: false }) })
  assert.ok(r.anomalies.some(a => a.includes('on-ramp')))
  assert.equal(r.metrics.floors[0].clear, 67)
})

test('boards probe: a failing gate is annotated, never rethrown', async () => {
  const r = await boardsProbe.run({ exec: (args) => ({ code: args[0].includes('loadout') ? 1 : 0, out: 'a wedge\nat (0.31, 0.44)', timedOut: false }) })
  assert.ok(r.anomalies.some(a => a.includes('GATE FAILED')))
})

test('invariants probe: holds on the real machine at quick depth', async () => {
  const r = await invariantsProbe.run({ depth: 'quick' })
  assert.deepEqual(r.anomalies, [])
  assert.ok(r.metrics.steps > 10000)
})
