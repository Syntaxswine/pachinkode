// The golden board — a fingerprint of the default geometry.
//
// This test exists because of a promise: buildBoard grew a second parameter
// (motif), and motif = null MUST be byte-identical to the board every measured
// number in this repo was calibrated on. The varnish suite pins same-process
// determinism; nothing pinned the geometry ACROSS versions until this did.
// If this hash moves, either you meant to move the default board (re-run
// EVERY instrument, then update the literal with the new measurements in the
// same commit) or you broke the promise — and the test cannot tell you which,
// only that the question must be answered.
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBoard } from '../src/sim/board.js'
import { baseLoadout } from '../src/sim/loadout.js'

/** Stable stringify of the geometry that matters, rounded past float noise. */
export function boardFingerprint (built) {
  const r6 = (x) => Math.round(x * 1e6) / 1e6
  const { world, parts } = built
  const s = []
  for (const n of world.nails) s.push(`n${r6(n.x)},${r6(n.y)},${r6(n.r)}`)
  for (const g of world.segments) s.push(`s${r6(g.ax)},${r6(g.ay)},${r6(g.bx)},${r6(g.by)},${r6(g.r)},${g.id || ''}`)
  for (const sn of world.sensors) s.push(`x${sn.kind},${r6(sn.x)},${r6(sn.y)},${r6(sn.w)},${r6(sn.h)}`)
  for (const ro of world.rotors) s.push(`r${r6(ro.x)},${r6(ro.y)},${r6(ro.r)},${ro.blades}`)
  const H = parts.housing
  if (H) s.push(`h${r6(H.x0)},${r6(H.y0)},${r6(H.x1)},${r6(H.y1)}`)
  const t = s.join(';')
  let h = 5381
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0
  return `${h.toString(16)}:${s.length}`
}

// The literal. Computed on the board as of 2026-07-29 (pre-motif), 107 grid
// nails + furniture + stock pockets. See header for what to do if it moves.
const GOLDEN = '70d3ac89:500'

test('the default board is byte-identical to the golden fingerprint', () => {
  const fp = boardFingerprint(buildBoard(baseLoadout()))
  assert.equal(fp, GOLDEN, `default board drifted: ${fp} — read this test's header before touching the literal`)
})

test('the fingerprint is deterministic across builds in-process', () => {
  assert.equal(boardFingerprint(buildBoard(baseLoadout())), boardFingerprint(buildBoard(baseLoadout())))
})
