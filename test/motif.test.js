// Motif boards — the laws that keep a picture from becoming a lie.
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBoard, validateMotifBoard, CLEAR_R } from '../src/sim/board.js'
import { baseLoadout, resolveLoadout } from '../src/sim/loadout.js'
import { MOTIFS, inSilhouette } from '../src/sim/motifs.js'
import { Machine } from '../src/sim/machine.js'
import { Run } from '../src/sim/run.js'
import { CABINETS } from '../src/sim/cabinets.js'
import { DT } from '../src/sim/world.js'

const tanukiLoadout = () => {
  const L = baseLoadout()
  L.motif = MOTIFS.tanuki
  return L
}

test('the tanuki board builds, validates, and puts the heso on the navel', () => {
  const { world, parts } = buildBoard(tanukiLoadout())
  assert.equal(parts.heso.x, MOTIFS.tanuki.heso.x)
  assert.equal(parts.heso.y, MOTIFS.tanuki.heso.y)
  assert.ok(world.nails.length > MOTIFS.tanuki.minNails)
  assert.ok(parts.displayRect, 'the relocated readout was not stamped')
  assert.equal(parts.tulips.length, 2)
  // the stage-over-heso law
  assert.ok(Math.abs(parts.stage.x - parts.heso.x) <= parts.stage.halfWidth)
})

test('the stock board is untouched: no displayRect, heso at 0.220/0.322', () => {
  const { parts } = buildBoard(baseLoadout())
  assert.equal(parts.displayRect, null)
  assert.equal(parts.heso.x, 0.220)
  assert.equal(parts.heso.y, 0.322)
  assert.equal(parts.motif, null)
})

test('the validator actually rings: a nail outside the field is named', () => {
  // An instrument never seen to alarm is a decoration — feed it a poisoned
  // synthetic board and demand the throw.
  const world = { nails: [{ x: 0.02, y: 0.02, r: 0.0009 }], sensors: [] }
  const parts = { buckets: [], sensors: {}, heso: { x: 0.2, y: 0.3 }, stage: null }
  assert.throws(
    () => validateMotifBoard(world, parts, { id: 'poison', minNails: 0 }),
    /outside CLEAR_R/)
})

test('a motif machine survives refit without shedding its board', () => {
  const L = tanukiLoadout()
  const m = new Machine({ seed: 5, tokens: 50, loadout: L })
  const before = m.parts.heso.y
  assert.equal(before, MOTIFS.tanuki.heso.y, 'construction ignored the motif')
  m.refit(L)
  assert.equal(m.parts.heso.y, MOTIFS.tanuki.heso.y, 'refit reverted to the stock board')
  assert.ok(m.parts.displayRect, 'refit dropped the relocated readout')
})

test('a TANUKIDAI run stamps the motif onto its loadout', () => {
  const run = new Run(CABINETS.tanukidai, 7)
  assert.equal(run.loadout.motif, MOTIFS.tanuki)
})

test('the corridor works: balls actually reach a heso inside the silhouette', () => {
  // The design risk unique to motif boards: an INTERIOR heso ringed by its
  // own contour. Drum-fire the real machine and demand tickets.
  const L = tanukiLoadout()
  const m = new Machine({ seed: 11, tokens: 900, fireInterval: 0.2, loadout: L })
  m.dial = 0.2
  m.firing = true
  let heso = 0, tulip = 0
  let guard = 0
  while (m.launched < 800 && guard++ < 3e6) {
    m.step(DT)
    for (const ev of m.drain()) {
      if (ev.type === 'heso') heso++
      if (ev.type === 'tulip') tulip++
    }
  }
  assert.ok(heso >= 3, `only ${heso} heso entries in 800 balls — the corridor is blocked`)
  assert.ok(tulip >= 1, `no tulip entries — the paw and tail catch nothing`)
})

test('inSilhouette agrees with the contour on obvious points', () => {
  const t = MOTIFS.tanuki
  assert.ok(inSilhouette(t, t.heso.x, t.heso.y - 0.02), 'the belly is inside')
  assert.ok(!inSilhouette(t, 0.05, 0.10), 'the far corner is outside')
})
