// Find ball traps in the board geometry before they find your statistics.
//
//   node tools/board-audit.js
//   node tools/board-audit.js --parts bucket,bucket,widen,tulips
//
// A pachinko board's characteristic failure is the WEDGE: two surfaces whose
// clear span is wider than nothing and narrower than a ball. Every ball that
// enters one stops there permanently. They are close to invisible by eye — the
// three found during this board's construction were a nail 10.5 mm from a tulip
// wing, a flat 70 mm attacker ledge, and a *converging* channel between a tulip
// cup and the launch rail whose span happened to sweep through 11 mm somewhere
// along its length.
//
// buildBoard() already culls offending NAILS automatically. It cannot cull a
// wall, so wall-versus-wall pinches are reported here for a human to move.
//
// The scan itself lives in tools/lib/pinch.js, so this tool and
// tools/loadout-audit.js cannot drift apart on what counts as a trap. This file
// is the human-readable report for ONE board — the board you asked for, or the
// stock one. That one is the GATE, across every board a run can build.
//
// Exit code is 0 even when pinches are found: this is an instrument, not a gate.
// A board may legitimately contain a narrow gap that no ball can reach.

import { buildBoard, BOARD } from '../src/sim/board.js'
import { resolveLoadout } from '../src/sim/loadout.js'
import {
  scanPinches, scanNailPinches, scanRotorPinches, blockedPockets,
  BALL_D, DANGER_LO, DANGER_HI
} from './lib/pinch.js'

const argv = process.argv.slice(2)
const pi = argv.indexOf('--parts')
const partIds = pi < 0 ? [] : (argv[pi + 1] || '').split(',').filter(Boolean)

const loadout = resolveLoadout(partIds)
const { world, parts } = buildBoard(loadout)

console.log(`\n  PACHINKODE board audit`)
if (partIds.length) console.log(`  loadout: ${partIds.join(', ')}`)
console.log(`  playfield ${(BOARD.w * 1000).toFixed(0)} × ${(BOARD.h * 1000).toFixed(0)} mm` +
  `   (legal: must fit a 500 mm square and contain a 300 mm circle)`)
console.log(`  ${world.nails.length} nails · ${world.segments.length} wall segments · ` +
  `${world.rotors.length} windmills · ${world.sensors.length} pockets · ` +
  `${parts.buckets.length} scoring buckets`)
if (parts.wedges.length) {
  console.log(`  ${parts.wedges.length} nails auto-culled as wedges at build time`)
}

// --- wall against wall, and wall against windmill --------------------------

const clusters = [...scanPinches(world), ...scanRotorPinches(world, parts)]

if (!clusters.length) {
  console.log(`\n  No wall-to-wall pinches in the ${(DANGER_LO * 1000).toFixed(1)}–` +
    `${(DANGER_HI * 1000).toFixed(1)} mm band. Clean.\n`)
} else {
  console.log(`\n  ${clusters.length} wall pinch cluster(s) in the trap band ` +
    `(${(DANGER_LO * 1000).toFixed(1)}–${(DANGER_HI * 1000).toFixed(1)} mm, ` +
    `ball is ${(BALL_D * 1000).toFixed(1)} mm):\n`)
  for (const c of clusters.slice(0, 20)) {
    console.log(`    ${(c.gap * 1000).toFixed(1).padStart(5)} mm  at ` +
      `(${c.x.toFixed(3)}, ${c.y.toFixed(3)})   ${c.a} ↔ ${c.b}   ×${c.n || 1} samples`)
  }
  console.log(`\n  A ball that reaches one of these stops there for good.`)
  console.log(`  Move one of the two structures, or close the gap entirely.\n`)
}

// --- nail against nail -----------------------------------------------------
//
// The regular grid can never trigger this — its tightest span is 18.8 mm — so
// anything here is an authored nail landing in a generated field, which is
// exactly where a human stops checking. buildBoard() culls these, so a clean
// report is the expected state; a finding means the cull was bypassed.

const realNail = scanNailPinches(world, parts)
if (!realNail.length) {
  console.log(`  No nail-to-nail pinches either (grid pitch alone gives 18.8 mm).`)
} else {
  console.log(`\n  ${realNail.length} NAIL-TO-NAIL pinch(es) — a ball will rest on top and stay:`)
  for (const p of realNail.slice(0, 12)) {
    console.log(`    ${(p.gap * 1000).toFixed(1).padStart(5)} mm  between ` +
      `(${p.a.x.toFixed(3)}, ${p.a.y.toFixed(3)}) and (${p.b.x.toFixed(3)}, ${p.b.y.toFixed(3)})`)
  }
}

// --- buckets with nothing above them ---------------------------------------

const blocked = blockedPockets(world, parts)
if (parts.buckets.length) {
  if (!blocked.length) {
    console.log(`  All ${parts.buckets.length} bucket mouths have a clear descent above them.`)
  } else {
    console.log(`\n  ${blocked.length} BLOCKED bucket(s): ${blocked.join(', ')}`)
    console.log(`  A wall stands over the mouth. The player paid a draft pick for a sealed hole.`)
  }
}

// --- the deliberate exception ----------------------------------------------

const [l, r] = parts.lifeNails
const heso = Math.hypot(l.x - r.x, l.y - r.y) - l.r - r.r
console.log(`  heso gap (life nails):  ${(heso * 1000).toFixed(2)} mm` +
  `  — deliberate, ${(BALL_D * 1000).toFixed(1)} mm ball, real boards run 11.25–12.50 mm`)
console.log(`  clearance per side:     ${((heso - BALL_D) / 2 * 1000).toFixed(2)} mm\n`)
