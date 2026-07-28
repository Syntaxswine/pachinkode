// Find ball traps in the board geometry before they find your statistics.
//
//   node tools/board-audit.js
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
// Exit code is 0 even when pinches are found: this is an instrument, not a gate.
// A board may legitimately contain a narrow gap that no ball can reach.

import { buildBoard, BOARD } from '../src/sim/board.js'
import { BALL_R } from '../src/sim/world.js'
import { closestOnSegment } from '../src/sim/vec.js'

const sharesEnd = (a, b) => {
  const near = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2) < 1e-6
  return near(a.ax, a.ay, b.ax, b.ay) || near(a.ax, a.ay, b.bx, b.by) ||
         near(a.bx, a.by, b.ax, b.ay) || near(a.bx, a.by, b.bx, b.by)
}

const BALL_D = BALL_R * 2
// The trap band is narrow and specific. Below one ball diameter a ball cannot
// enter, so the gap is harmless however tight. Much above it, the ball passes
// straight through. The danger is the sliver in between: wide enough to admit,
// too tight to release.
const DANGER_LO = BALL_D - 0.0002
const DANGER_HI = BALL_D + 0.0016

// Structures whose whole job is to catch a ball and hold it until a sensor fires.
// A pocket mouth is a wedge on purpose.
const POCKETS = /^(tulip|heso|attacker-flap)/

// Segments belonging to one continuous boundary. Two points far apart along the
// same smooth wall are a chord, not a pinch, and reporting them buries the real
// findings under noise.
const CHAIN = { 'rail-outer': 'outer', bowl: 'outer', 'foul-stop': 'outer', 'return-rubber': 'outer' }

const { world, parts } = buildBoard()

console.log(`\n  PACHINKODE board audit`)
console.log(`  playfield ${(BOARD.w * 1000).toFixed(0)} × ${(BOARD.h * 1000).toFixed(0)} mm` +
  `   (legal: must fit a 500 mm square and contain a 300 mm circle)`)
console.log(`  ${world.nails.length} nails · ${world.segments.length} wall segments · ` +
  `${world.rotors.length} windmills · ${world.sensors.length} pockets`)
if (parts.wedges.length) {
  console.log(`  ${parts.wedges.length} nails auto-culled as wedges at build time`)
}

// Sample points along every segment, then measure each against every other
// segment it does not share an endpoint with.
const SAMPLES = 9
const pinches = []
const segs = world.segments.filter(s => !s.disabled)

for (let i = 0; i < segs.length; i++) {
  const a = segs[i]
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES
    const p = { x: a.ax + (a.bx - a.ax) * t, y: a.ay + (a.by - a.ay) * t }
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j]
      if (a.id && b.id && a.id === b.id) continue          // same structure
      if (sharesEnd(a, b)) continue
      if (POCKETS.test(a.id || '') || POCKETS.test(b.id || '')) continue
      const ca = CHAIN[a.id], cb = CHAIN[b.id]
      if (ca && ca === cb) continue
      const c = closestOnSegment(p, { x: b.ax, y: b.ay }, { x: b.bx, y: b.by })
      const gap = Math.hypot(p.x - c.x, p.y - c.y) - a.r - b.r
      if (gap > DANGER_LO && gap < DANGER_HI) {
        pinches.push({ gap, x: (p.x + c.x) / 2, y: (p.y + c.y) / 2, a: a.id || '?', b: b.id || '?' })
      }
    }
  }
}

// Collapse to clusters so one long converging channel reports once.
const clusters = []
for (const p of pinches.sort((x, y) => x.gap - y.gap)) {
  const near = clusters.find(c => Math.hypot(c.x - p.x, c.y - p.y) < 0.020 && c.a === p.a && c.b === p.b)
  if (near) { near.n++; near.gap = Math.min(near.gap, p.gap) } else clusters.push({ ...p, n: 1 })
}

if (!clusters.length) {
  console.log(`\n  No wall-to-wall pinches in the ${(DANGER_LO * 1000).toFixed(1)}–${(DANGER_HI * 1000).toFixed(1)} mm band. Clean.\n`)
} else {
  console.log(`\n  ${clusters.length} wall pinch cluster(s) in the trap band ` +
    `(${(DANGER_LO * 1000).toFixed(1)}–${(DANGER_HI * 1000).toFixed(1)} mm, ball is ${(BALL_D * 1000).toFixed(1)} mm):\n`)
  for (const c of clusters.slice(0, 20)) {
    console.log(`    ${(c.gap * 1000).toFixed(1).padStart(5)} mm  at (${c.x.toFixed(3)}, ${c.y.toFixed(3)})` +
      `   ${c.a} ↔ ${c.b}   ×${c.n} samples`)
  }
  console.log(`\n  A ball that reaches one of these stops there for good.`)
  console.log(`  Move one of the two structures, or close the gap entirely.\n`)
}

// Report the deliberate exception so nobody "fixes" it.
const [l, r] = parts.lifeNails
const heso = Math.hypot(l.x - r.x, l.y - r.y) - l.r - r.r
console.log(`  heso gap (life nails):  ${(heso * 1000).toFixed(2)} mm` +
  `  — deliberate, ${(BALL_D * 1000).toFixed(1)} mm ball, real boards run 11.25–12.50 mm`)
console.log(`  clearance per side:     ${((heso - BALL_D) / 2 * 1000).toFixed(2)} mm\n`)
