// The wedge scan, extracted so more than one instrument can run it.
//
// This logic used to live inside tools/board-audit.js, which was correct while
// there was exactly one board. The roguelike makes the board a function of the
// loadout, and the number of reachable boards is now the product of every
// widening step, every bucket count and every cabinet's starting parts —
// several hundred, none of which a human is going to eyeball.
//
// So the scan became a library and tools/loadout-audit.js sweeps it across the
// space. board-audit.js still exists and still prints the human-readable report
// for a single board; it now imports from here rather than owning it, so there
// is one definition of the trap band and it cannot drift between the tool that
// checks one board and the tool that checks all of them.

import { BALL_R } from '../../src/sim/world.js'
import { closestOnSegment } from '../../src/sim/vec.js'

export const BALL_D = BALL_R * 2

// The trap band is narrow and specific. Below one ball diameter a ball cannot
// enter, so the gap is harmless however tight. Much above it, the ball passes
// straight through. The danger is the sliver in between: wide enough to admit,
// too tight to release.
export const DANGER_LO = BALL_D - 0.0002
export const DANGER_HI = BALL_D + 0.0016

// Structures whose whole job is to catch a ball and hold it until a sensor
// fires. A pocket mouth is a wedge on purpose. Buckets join this list for the
// same reason the heso is on it: the cup's own two walls are one ball apart by
// design, and reporting that would bury every real finding under seven copies
// of "the bucket is bucket-shaped".
export const POCKETS = /^(tulip|heso|attacker-flap|bucket-)/

/**
 * The STRUCTURE a segment id belongs to — 'bucket-westLow-L' → 'bucket-westLow',
 * 'tulipL-cupB' → 'tulipL', 'heso-R' → 'heso'.
 *
 * This exists because the old exemption was too broad and hid a real class of
 * trap. It skipped any pair where EITHER segment was pocket furniture, which
 * meant a tulip cup converging against the launch rail was invisible to the
 * tool — and the header of board-audit.js lists exactly that as one of the
 * three traps that had to be chased by hand. It was chased by hand because the
 * instrument was looking away.
 *
 * Now the exemption requires both segments to belong to the same pocket. Two
 * different buckets pinching against each other is reported, which matters a
 * great deal once mouths can be widened until adjacent cups nearly touch.
 */
export function structOf (id = '') {
  return id.replace(/-(cup)?[LRB]$/, '')
}

// Segments belonging to one continuous boundary. Two points far apart along the
// same smooth wall are a chord, not a pinch.
// `attacker-flap` belongs here and not in POCKETS, which is a correction the
// stricter exemption above forced into the open. The flap is not furniture
// sitting near the wall — board.js builds it AS AN ARC OF THAT WALL, at the
// same radius, so that closed there is no ledge and no crevice. Two points on
// one circle 10.9 mm apart are a chord. The old broad pocket exemption hid this
// by accident; naming it as part of the outer boundary is the honest reason.
export const CHAIN = {
  'rail-outer': 'outer', bowl: 'outer', 'foul-stop': 'outer', 'return-rubber': 'outer',
  'attacker-flap': 'outer'
}

const sharesEnd = (a, b) => {
  const near = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2) < 1e-6
  return near(a.ax, a.ay, b.ax, b.ay) || near(a.ax, a.ay, b.bx, b.by) ||
         near(a.bx, a.by, b.ax, b.ay) || near(a.bx, a.by, b.bx, b.by)
}

/**
 * Wall-against-wall pinches, clustered.
 *
 * `samePocketOnly` is the subtlety that made buckets safe to add. A bucket's
 * own walls are a deliberate wedge and must be skipped — but a bucket wall
 * against the LAUNCH RAIL is the single most dangerous shape on this board, and
 * the first placement of the west bucket produced exactly it (11.1 mm, at
 * 0.094/0.373, found the moment the sweep first ran). So the exemption is keyed
 * on BOTH segments being pocket furniture, never on either.
 */
export function scanPinches (world, { samples = 9 } = {}) {
  const pinches = []
  const segs = world.segments.filter(s => !s.disabled)

  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]
    for (let k = 0; k <= samples; k++) {
      const t = k / samples
      const p = { x: a.ax + (a.bx - a.ax) * t, y: a.ay + (a.by - a.ay) * t }
      for (let j = i + 1; j < segs.length; j++) {
        const b = segs[j]
        if (a.id && b.id && a.id === b.id) continue
        if (sharesEnd(a, b)) continue
        // Exempt only when both belong to the SAME pocket. One pocket wall
        // against anything else — another bucket, the rail, the housing — is
        // precisely the trap we are hunting.
        if (POCKETS.test(a.id || '') && POCKETS.test(b.id || '') &&
            structOf(a.id) === structOf(b.id)) continue
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

  const clusters = []
  for (const p of pinches.sort((x, y) => x.gap - y.gap)) {
    const near = clusters.find(c =>
      Math.hypot(c.x - p.x, c.y - p.y) < 0.020 && c.a === p.a && c.b === p.b)
    if (near) { near.n++; near.gap = Math.min(near.gap, p.gap) } else clusters.push({ ...p, n: 1 })
  }
  return clusters
}

/**
 * Wall-against-WINDMILL pinches.
 *
 * A gap this tool never looked at until buckets arrived. `clearWedges` in
 * board.js checks nails against rotors, and the segment scan checks walls
 * against walls, and between those two the case of a WALL against a rotor fell
 * straight through — which was survivable while every wall on the board was
 * placed by hand next to two windmills that never moved, and is not survivable
 * now that a part can bolt a cup anywhere in the field.
 *
 * A windmill is a spinning disc of blades; the ball clears it or it does not.
 * The swept circle is what matters, so the rotor is treated as a disc of radius
 * r plus a blade half-thickness.
 */
export function scanRotorPinches (world, parts) {
  const out = []
  for (const ro of parts.rotors || []) {
    for (const s of world.segments) {
      if (s.disabled) continue
      const c = closestOnSegment({ x: ro.x, y: ro.y }, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by })
      const gap = Math.hypot(ro.x - c.x, ro.y - c.y) - ro.r - 0.0022 - s.r
      if (gap > DANGER_LO && gap < DANGER_HI) {
        out.push({ gap, x: c.x, y: c.y, a: s.id || '?', b: 'windmill' })
      }
    }
  }
  return out
}

/**
 * Is the approach to each bucket's mouth OBSTRUCTED?
 *
 * "No pinches" is necessary and not sufficient — a bucket sealed inside the
 * centre housing reports a perfectly clean audit, because a sealed box has no
 * narrow gaps in it. It also never sees a ball. So something has to check.
 *
 * ── WHY THIS IS NOT A FLOOD FILL ────────────────────────────────────────────
 *
 * The first version of this function was one: mark free cells, flood from the
 * open field, assert every mouth is wet. It reported the west shoulder bucket
 * as unreachable on a board where it is plainly reachable, and the reason is
 * worth writing down because it is a trap any future builder will walk into.
 *
 * A 13 mm mouth admits an 11 mm ball with 1 mm of clearance per side. A grid
 * fine enough to represent a 1 mm corridor needs cells well under a
 * millimetre; the regular nail field has a 20.6 mm pitch and 5.9 mm of
 * clearance per nail, leaving 7 mm gaps that a 4 mm grid resolves as
 * intermittently sealed. At that resolution the answer is noise with the shape
 * of an answer — the most dangerous kind of instrument output, because it looks
 * like a measurement.
 *
 * So this checks something narrower and TRUE: is the corridor directly above
 * the mouth clear for one ball's descent? That catches the failure it was
 * written for (a bucket inside a box, a bucket under the housing roof, a bucket
 * behind a wall) and claims nothing about global connectivity.
 *
 * The real reachability question — does a ball ever actually GET there, and how
 * often — is not a geometry question at all. It is answered by firing balls at
 * it, and `node tools/run-sim.js --sites` prints the per-site entry counts.
 */
export function blockedPockets (world, parts) {
  const bad = []
  const reach = 0.030                       // how far above the rim to look
  for (const b of parts.buckets || []) {
    const ownWalls = new Set([`bucket-${b.site}-L`, `bucket-${b.site}-R`, `bucket-${b.site}-B`])
    let blocked = false
    for (let d = BALL_R + 0.001; d <= reach && !blocked; d += 0.002) {
      const p = { x: b.x, y: b.y - d }
      for (const s of world.segments) {
        if (s.disabled || ownWalls.has(s.id)) continue
        const c = closestOnSegment(p, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by })
        if (Math.hypot(p.x - c.x, p.y - c.y) < s.r + BALL_R) { blocked = true; break }
      }
      // Windmills are deliberately NOT counted as blockers. A rotor cannot seal
      // anything — it spins, it sheds, and scattering balls sideways and down
      // is its entire function; a bucket in a windmill's shadow is a bucket the
      // windmill FEEDS. Counting it flagged the two stock buckets as broken on
      // the stock board, which is a good demonstration of why an instrument
      // should test the thing it was written for and not a proxy that happens
      // to be easier to compute.
    }
    if (blocked) bad.push(b.site)
  }
  return bad
}

/**
 * Nail-against-nail pinches, excluding the life pair (whose entire purpose is
 * to be a gap measured in tenths of a millimetre).
 */
export function scanNailPinches (world, parts) {
  const out = []
  for (let i = 0; i < world.nails.length; i++) {
    for (let j = i + 1; j < world.nails.length; j++) {
      const a = world.nails[i], b = world.nails[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r
      if (gap > 0 && gap < DANGER_HI) out.push({ gap, a, b })
    }
  }
  const lifePair = new Set(parts.lifeNails)
  return out.filter(p => !(lifePair.has(p.a) && lifePair.has(p.b)))
}
