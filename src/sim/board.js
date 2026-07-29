// The machine's geometry.
//
// Laid out as a modern (digital) pachinko board, because modern pachinko has the
// structure worth simulating: a big centre housing for the display, a nail field
// you must thread, and a start pocket that does not pay you — it buys you a
// lottery ticket. See docs/PLAN-THE-HONEST-MACHINE.
//
// Everything is in metres. Coordinates are y-down, origin at the top-left of the
// playfield, matching the canvas so the renderer only ever applies a scale.
//
// ── THE THRESHOLD ────────────────────────────────────────────────────────────
// The single most important thing in this file is emergent, not authored.
//
// The launch channel is a circular arc. The inner wall stops at 250°, a little
// before the crest. A ball arriving there is still supported from outside by the
// outer wall only if it is going fast enough to need it:  v² / R ≥ g·|sin θ|.
// At 250° that works out to about 1.38 m/s. Below it, the ball falls inward and
// rains down the middle of the board. Above it, the ball stays pinned to the
// outer wall, carries all the way round, and comes down the far right.
//
// Two routes, one knob — which is precisely what Japanese players call
// *hidari-uchi* and *migi-uchi*, left-hitting and right-hitting. Nobody designed
// that split into this file. It falls out of v²/R ≥ g sin θ.
//
// BUT IT IS NOT A HARD BOUNDARY, and an earlier version of this comment said it
// was. Measured, the right-route share climbs smoothly from 5% at dial 0 to 99%
// by dial 0.42, crossing even odds around 0.19. The energy a ball has left at
// 250° is not set by launch speed alone: it rattles between the channel walls on
// the way up and the surviving energy varies chaotically from shot to shot. So
// the split is *probabilistic*, and it is fuzzy for an intrinsic reason rather
// than because the launcher is imprecise — the fuzziness is still there with the
// launcher fired from rest at its tightest.
//
// Which makes the real finding better than the clean one. There is a dial
// position where you genuinely cannot know which way a ball will go, it is
// findable, and it sits essentially on top of the setting that best feeds the
// start pocket. Maximum uncertainty and maximum value at the same place on the
// knob. See ROUTE_ODDS below and docs/SCIENCE.md §4.
// ─────────────────────────────────────────────────────────────────────────────

import { World, makeBall, MAT, BALL_R } from './world.js'
import { closestOnSegment } from './vec.js'
import { BOARD } from './board-consts.js'
import { baseLoadout, BUCKET_SITES } from './loadout.js'
import { inSilhouette, rosetteNails } from './motifs.js'

export { BOARD }

const D2R = Math.PI / 180
const R = BOARD.rail
/** Nail shank radius. Real kugi are 1.7–2.0 mm across; brass, 150–230 HV. */
export const NAIL_R = 0.0009
/** Half-thickness of the segments walls are made of. */
const SEG_R = 0.0022

/**
 * Where to put two segment *centrelines* so the CLEAR span between their
 * surfaces is `clear`. Forgetting this is how the first build ended up with a
 * nominally 13 mm mouth that was really 8.6 mm — impassable to an 11 mm ball,
 * and a wedge that trapped a hundred balls a run. Regulated mouth widths are
 * clear openings, so every pocket in this file goes through here.
 */
const clearHalf = (clear, segR = SEG_R) => clear / 2 + segR
/** Furniture must stay inside this radius or it fouls the launch channel. */
export const CLEAR_R = R.r - R.gap - BALL_R - 0.003   // = 0.1775 m

const px = (deg, rad) => R.cx + Math.cos(deg * D2R) * rad
const py = (deg, rad) => R.cy + Math.sin(deg * D2R) * rad

/**
 * Build a playfield.
 *
 * `loadout` describes what is bolted to it — see loadout.js. Called with
 * nothing it produces the stock machine, which is what every tool and test that
 * predates the roguelike still expects.
 *
 * The order below is load-bearing and always has been: furniture goes down
 * first, and the wedge sweep runs LAST, over everything. Parts multiply the
 * number of possible boards past what anyone can inspect, so the sweep is no
 * longer a safety net — it is the only reason an arbitrary loadout is safe to
 * hand a player at all.
 */
/**
 * `motif` (optional) is a per-cabinet board layout — geometry authored from an
 * image rather than the standard grid (see motifs.js). It rides the LOADOUT
 * (loadout.motif, stamped by Run from the cabinet) so machines, refits and
 * floor rebuilds inherit it without a single call-site change. LAWS:
 *   - motif === null is BYTE-IDENTICAL to the pre-motif board; the golden
 *     fingerprint test pins this.
 *   - a motif owns the FIELD INTERIOR only. The rail, bowl, launcher and foul
 *     channel are never a motif's to touch — that is what keeps ROUTE_ODDS,
 *     FOUL_ODDS, speedFor and the stuck-ball channel test honest on every
 *     board without per-motif re-measurement.
 *   - the build order below never changes; the wedge sweep runs LAST over
 *     whatever geometry a motif emits, exactly as for loadouts.
 *   - motifs reposition existing pocket KINDS; they never invent event types.
 */
export function buildBoard (loadout = baseLoadout(), motif = loadout.motif || null) {
  const world = new World({ w: BOARD.w, h: BOARD.h })
  const parts = {
    nails: [], tulips: [], rotors: [], sensors: {}, attacker: null, housing: null,
    buckets: [], loadout, motif
  }

  buildRail(world)
  buildHousing(world, parts, loadout, motif)
  buildNailField(world, parts, loadout, motif)
  buildFurniture(world, parts, loadout, motif)
  buildPockets(world, parts, loadout, motif)
  buildBuckets(world, parts, loadout)
  parts.wedges = clearWedges(world, parts)
  if (motif) validateMotifBoard(world, parts, motif)

  world.markDirty()
  return { world, parts }
}

/**
 * The motif legality gate, run AFTER the wedge sweep so it judges the board
 * the player actually gets. Throws with every violation named, because a
 * motif that fails one law usually fails several and a builder wants the
 * whole list. These are the field-interior laws from the census:
 * everything inside CLEAR_R, nothing in the drain band or the launch
 * channel (a channel nail breaks the _enteredPlay refund invariant), every
 * bucket sensor priced, and the warp stage over the heso.
 */
export function validateMotifBoard (world, parts, motif) {
  const bad = []
  for (const n of world.nails) {
    const d = Math.hypot(n.x - R.cx, n.y - R.cy)
    if (d > CLEAR_R + 1e-9) bad.push(`nail outside CLEAR_R at (${n.x.toFixed(3)}, ${n.y.toFixed(3)})`)
    if (n.y > 0.400 + 1e-9) bad.push(`nail in the drain band at (${n.x.toFixed(3)}, ${n.y.toFixed(3)})`)
  }
  for (const s of world.sensors) {
    if (s.kind === 'bucket' && !parts.buckets.find(b => b.site === s.id)) {
      bad.push(`bucket sensor '${s.id}' has no parts entry — it would silently score 1`)
    }
  }
  const st = parts.stage
  if (parts.sensors.warpL || parts.sensors.warpR) {
    if (!st) bad.push('warp mouths without a stage to deliver to')
    else if (Math.abs(parts.heso.x - st.x) > st.halfWidth) bad.push('the stage does not sit over the heso')
  }
  if (world.nails.length < (motif.minNails || 0)) {
    bad.push(`only ${world.nails.length} nails survived — under the motif's declared floor of ${motif.minNails}`)
  }
  if (bad.length) throw new Error(`motif '${motif.id}' failed board validation:\n  ` + bad.join('\n  '))
}

/**
 * Remove nails that form a wedge — a gap wide enough for a ball to enter and too
 * narrow for it to leave.
 *
 * This is the board's most persistent failure mode and it is not obvious by eye.
 * A nail at the regular grid pitch can land 10.5 mm from a tulip wing or a
 * housing wall, and 10.5 mm is a fraction under a ball diameter: every ball that
 * finds it stops there for good. Three separate hand-fixes chased three
 * instances of this before it became clear it wanted a rule instead.
 *
 * The rule: the clear span between a nail and any wall must be either wide
 * enough to pass a ball with margin, or nothing at all. Nothing in between.
 * The deliberate exception is the pair of life nails, whose entire purpose is to
 * be a gap measured in tenths of a millimetre — they are checked against each
 * other, never culled.
 */
function clearWedges (world, parts, verbose = false) {
  const BALL_D = BALL_R * 2
  const MIN_CLEAR = BALL_D + 0.0018        // must pass a ball with margin
  const removed = []
  // Both guarded: a motif field may legitimately have no life-nail pair (its
  // funnel can be the contour itself), and an unguarded spread here was the
  // first crash every motif prototype would have hit.
  const protectedNails = new Set([...(parts.lifeNails || []), ...(parts.featureNails || [])])

  // Pass 1 — nails against walls and windmills.
  let keep = []
  for (const n of world.nails) {
    if (protectedNails.has(n)) { keep.push(n); continue }
    let worst = Infinity
    for (const s of world.segments) {
      const c = closestOnSegment(n, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by })
      const gap = Math.hypot(n.x - c.x, n.y - c.y) - n.r - s.r
      if (gap < worst) worst = gap
    }
    for (const ro of parts.rotors) {
      const gap = Math.hypot(n.x - ro.x, n.y - ro.y) - n.r - ro.r - 0.0022
      if (gap < worst) worst = gap
    }
    if (worst > 0 && worst < MIN_CLEAR) { removed.push({ nail: n, gap: worst, against: 'wall' }); continue }
    keep.push(n)
  }

  // Pass 2 — nails against EACH OTHER.
  //
  // This pass was missing for the first day of the board's life, and a 60 000-ball
  // soak found what small runs could not: 1.1% of balls coming to rest on a pair
  // of nails 11.3 mm apart centre-to-centre — a 9.5 mm clear span, narrower than
  // the ball, which sits on top and never falls through. The offender was a
  // hand-placed right-route nail landing between two grid nails.
  //
  // The rule is identical to the wall rule, which is the point: it is the same
  // defect, and the tool only saw half of it. The regular grid can never trigger
  // this (its tightest span is 18.8 mm) — it fires exactly where an authored nail
  // meets a generated one, which is precisely where a human stops checking.
  //
  // Feature nails win ties, so the deliberate ones survive and the grid yields.
  const survivors = []
  for (let i = 0; i < keep.length; i++) {
    const a = keep[i]
    if (protectedNails.has(a)) { survivors.push(a); continue }
    let culled = false
    for (let j = 0; j < keep.length; j++) {
      if (i === j) continue
      const b = keep[j]
      // Only yield to a nail that is itself surviving: protected ones, or ones
      // already accepted. Prevents both halves of a pair being removed.
      if (!protectedNails.has(b) && !survivors.includes(b)) continue
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r
      if (gap > 0 && gap < MIN_CLEAR) {
        removed.push({ nail: a, gap, against: 'nail' })
        culled = true
        break
      }
    }
    if (!culled) survivors.push(a)
  }
  keep = survivors

  if (removed.length !== 0) {
    const kept = new Set(keep)
    world.nails = keep
    parts.nails = parts.nails.filter(n => kept.has(n))
    world.markDirty()
  }
  if (verbose && removed.length) {
    for (const r of removed) {
      console.log(`  wedge culled at (${r.nail.x.toFixed(3)}, ${r.nail.y.toFixed(3)}) ` +
        `gap ${(r.gap * 1000).toFixed(1)} mm vs ${r.against}`)
    }
  }
  return removed
}

// --- the launch rail and the bowl ----------------------------------------

function arc (world, radius, from, to, mat, tag, thick = 0.0018) {
  // 1.5° chords on a 206 mm radius give a 5.4 mm facet — under one ball radius,
  // so the ball rolls along the rail instead of clattering down a staircase.
  const step = 1.5
  let ax = px(from, radius), ay = py(from, radius)
  for (let a = from + step; a <= to + 1e-9; a += step) {
    const x = px(a, radius), y = py(a, radius)
    world.addSegment(ax, ay, x, y, thick, mat, tag)
    ax = x; ay = y
  }
}

function buildRail (world) {
  const { r, gap } = R
  arc(world, r, BOARD.railStart - 8, BOARD.railOuterEnd, MAT.rail, 'rail-outer')
  arc(world, r - gap, BOARD.railStart, BOARD.railInnerEnd, MAT.rail, 'rail-inner')

  // The return wedge.
  //
  // Without this the machine is broken, and the reason is a nice piece of physics.
  // A ball fast enough to stay pinned to the outer wall at the threshold stays
  // pinned *forever*: past the crest the wall curves away, but the centripetal
  // requirement v²/R ≥ g·sinθ only gets easier as θ increases, so a smooth circle
  // never releases what it has caught. The first build of this board sent every
  // strong shot sailing round the outside and straight down the drain, touching
  // not one nail.
  //
  // Real boards face the same geometry and break the ball off the rail at the top
  // right, where the 天釘 (top nails) sit — the one spot on a board a player can
  // genuinely aim at. Pachinkode uses a rubber wedge there instead, because a
  // deformable block gives a cleaner and more tunable release than a nail pair.
  //
  // An earlier version of this comment called the part 返しゴム and presented that
  // as its real name. Two research passes over Japanese board-part references
  // could not find any rubber component by that name, or any ゴム part at the rail
  // top at all. The physics is measured and load-bearing; the name was not, so it
  // is gone. `MAT.rubber` and the `return-rubber` tag are internal names only.
  // Built as a closed triangle welded to the wall, not a single fin. A bare fin
  // leaves an acute pocket on its downstream side, and an acute pocket against a
  // curved wall passes through one ball diameter somewhere — the same trap as the
  // tulips, in miniature.
  const ra = BOARD.returnRubber
  const tipA = ra + 7, tipR = r - 0.030
  world.addSegment(px(ra, r), py(ra, r), px(tipA, tipR), py(tipA, tipR), 0.0022, MAT.rubber, 'return-rubber')
  world.addSegment(px(tipA, tipR), py(tipA, tipR), px(ra + 15, r), py(ra + 15, r), 0.0022, MAT.rubber, 'return-rubber')

  // The foul stop: a short radial wall just below the launch point. A shot too
  // weak to reach the threshold rolls back down and is caught here rather than
  // spilling into the field. Real machines refund these.
  const fa = BOARD.railStart - 5
  world.addSegment(px(fa, r), py(fa, r), px(fa, r - gap), py(fa, r - gap), 0.0018, MAT.wall, 'foul-stop')

  // The bowl: containment below the channel, open at the bottom for the out hole.
  arc(world, r, BOARD.railOuterEnd, 360 + BOARD.bowlGap[0], MAT.wall, 'bowl')
  arc(world, r, BOARD.bowlGap[1], BOARD.railStart - 8, MAT.wall, 'bowl')
}

/**
 * Where a ball enters the channel, and the unit tangent it is fired along.
 *
 * The ball starts in contact with the OUTER wall, not floating at mid-channel.
 * Launching it mid-gap made it fall 2.7 mm onto the rail and bounce, and since
 * the rail is lossy the surviving energy depended on the phase of that bounce —
 * which made the foul rate chaotic rather than monotonic in dial position: 11%
 * at 0.25, 35% at 0.30, 82% at 0.35, 21% at 0.40, over a total speed spread of
 * six per cent. Gravity presses the ball outward here anyway, so contact at t=0
 * is also the physically honest starting condition.
 */
export function launchPoint () {
  const a = BOARD.railStart * D2R
  const rad = R.r - 0.0018 - BALL_R
  return {
    x: R.cx + Math.cos(a) * rad,
    y: R.cy + Math.sin(a) * rad,
    dx: -Math.sin(a),
    dy: Math.cos(a)
  }
}

/**
 * The speed at which a ball just barely stays pinned to the outer wall at the
 * point the inner wall ends — i.e. the boundary between the two routes.
 * Exported because the HUD marks it on the dial, and because tools/calibrate.js
 * checks that the measured boundary matches this closed form.
 */
/**
 * Measured probability that a ball takes the right-hand route, by dial setting.
 *
 * This is data, not a model. A closed-form estimate from the launch energy and
 * the rail climb puts the boundary at dial 0.55; the machine actually crosses
 * even odds at 0.19, because the closed form ignores everything the ball loses
 * rattling up the channel. The estimate was wrong by a third of the dial's
 * travel, and it was being drawn on the HUD as a tick mark.
 *
 * Regenerate with:  node tools/headless.js --threshold --balls 220
 * Sampled at 220 balls per point, monotonicity enforced (the wobble is sampling
 * noise; the underlying relationship is monotone and odds that went backwards as
 * you turned the dial up would be a lie in the other direction).
 *
 * SCOPE: these are SOLO-SHOT odds — a ball with the channel to itself, which is
 * what the regulation cadence (and any deliberate tap) gives it. They hold
 * under rapid fire for dials ≥ ~0.15 (measured at 0.2 s cadence: within a few
 * points of this table from 0.18 up). BELOW that, under sustained rapid fire,
 * the split is collision-dominated and genuinely unpredictable: consecutive
 * slow balls rear-end each other on the climb — measured 347 in-channel
 * ball-ball impacts per 200 balls at dial 0.06 / 0.2 s cadence, versus 45 at
 * regulation — and the measured share swings tens of points between runs
 * (29%, then 50%, same seed, different n). No table can honestly describe that
 * regime; the HUD instead names it while it is happening. The channel jam
 * itself is kept deliberately: it is physical, it clears within seconds of
 * easing off, and the operator has ruled it a mechanic from direct experience —
 * on a 1970s machine they owned, with no return-ball prevention at all, the
 * clog was CUMULATIVE: none of the returning balls had escape velocity and all
 * of them came back down into the plunger area. Modern boards carry return
 * prevention parts (patents JP2003033484A, JP2978440B2) that reduce but do not
 * eliminate it. This board sits between the two: fallers interfere while the
 * stream runs, then settle and are refunded once it stops.
 */
export const ROUTE_ODDS = [
  [0.00, 0.10], [0.03, 0.10], [0.06, 0.18], [0.09, 0.27], [0.12, 0.31],
  [0.15, 0.42], [0.18, 0.48], [0.21, 0.58], [0.24, 0.64], [0.27, 0.75],
  [0.30, 0.85], [0.33, 0.93], [0.36, 0.95], [0.39, 0.98], [0.42, 0.99],
  [0.45, 1.00], [1.00, 1.00]
]

/** P(right-hand route) at a dial setting, interpolated from the measurements. */
export function routeOdds (dial) {
  const d = Math.max(0, Math.min(1, dial))
  for (let i = 1; i < ROUTE_ODDS.length; i++) {
    const [x1, y1] = ROUTE_ODDS[i]
    if (d <= x1) {
      const [x0, y0] = ROUTE_ODDS[i - 1]
      const t = x1 === x0 ? 0 : (d - x0) / (x1 - x0)
      return y0 + (y1 - y0) * t
    }
  }
  return ROUTE_ODDS[ROUTE_ODDS.length - 1][1]
}

/**
 * Measured probability that a SOLO shot fouls (fails to crest), by dial.
 *
 * This replaces a closed-form crest inversion the topbar used to print 'FOUL'
 * from, which put the boundary at power ≈ 0.135 — while measurement says ~99%
 * of solo shots at dial 0.06 enter play. Same failure class as the old 50:50
 * tick: an estimate drawn as a fact, a third of the travel out of place. The
 * real cliff is sharp and low: 99% at dial 0.00, 53% at 0.03, ~1% by 0.06.
 *
 * Regenerate with:  node tools/headless.js --foulcurve --balls 150
 * Solo cadence, non-increasing clamp (more speed cannot honestly mean more
 * solo fouls; the wobble is sampling noise).
 */
export const FOUL_ODDS = [
  [0.00, 0.99], [0.03, 0.53], [0.06, 0.01], [0.09, 0.01], [0.12, 0.01],
  [0.15, 0.01], [0.21, 0.00], [0.30, 0.00], [1.00, 0.00]
]

/** P(solo shot fouls) at a dial setting, interpolated from the measurements. */
export function foulOdds (dial) {
  const d = Math.max(0, Math.min(1, dial))
  for (let i = 1; i < FOUL_ODDS.length; i++) {
    const [x1, y1] = FOUL_ODDS[i]
    if (d <= x1) {
      const [x0, y0] = FOUL_ODDS[i - 1]
      const t = x1 === x0 ? 0 : (d - x0) / (x1 - x0)
      return y0 + (y1 - y0) * t
    }
  }
  return FOUL_ODDS[FOUL_ODDS.length - 1][1]
}

/** The dial setting where the two routes are closest to even odds. */
export function coinFlipDial () {
  let best = 0, bestGap = 1
  for (let d = 0; d <= 1.0001; d += 0.005) {
    const gap = Math.abs(routeOdds(d) - 0.5)
    if (gap < bestGap) { bestGap = gap; best = d }
  }
  return best
}

export function thresholdCrestSpeed () {
  const inward = -Math.sin(BOARD.railInnerEnd * D2R)   // radial component of g, outward-positive
  return Math.sqrt(Math.max(0, inward) * 9.80665 * R.r)
}

// --- the centre housing ---------------------------------------------------

function buildHousing (world, parts, L, motif = null) {
  // The housing is gabled, not flat-topped. A flat roof is a shelf, and a shelf
  // in a pachinko machine is a ball trap — the first build parked forty-eight
  // balls up here per run. Real centre housings are domed or peaked for exactly
  // this reason: every upward-facing surface on a real board sheds.
  // The housing sits well below the rail exit. In the first layout its roof was
  // directly under the release point, so a weak shot landed on it and rolled
  // straight into a warp — eighty per cent of balls at low dial. A board needs
  // scattering distance between the rail and its first big obstacle.
  //
  // The rule about upward-facing surfaces is not that they all shed — the stage
  // built fifty lines below is a surface that deliberately *carries* balls, and
  // stage performance is a marketed characteristic of real machines. The rule is
  // that none of them may be a stable equilibrium: a ball always leaves, and
  // never at the same instant twice.
  // A motif may relocate and reshape the housing (a spec with the same five
  // numbers travelling together), but the dome law and the roof-carved warp
  // mouths below apply to EVERY housing, wherever it stands.
  const spec = (motif && motif.housing) ||
    { x0: 0.126, x1: 0.314, y0: 0.166, y1: 0.292, rise: 0.038, warps: [0.163, 0.277] }
  const { x0, x1, y0, y1 } = spec
  const rr = 0.020
  const seg = (ax, ay, bx, by) => world.addSegment(ax, ay, bx, by, SEG_R, MAT.wall, 'housing')

  // A domed roof rather than a gable. A gable has an apex, an apex is a balance
  // point, and a deterministic simulation will park a ball on a balance point
  // forever. The exponent on t skews the crown off-centre so there is no exact
  // equilibrium at the midline either.
  const rise = spec.rise
  const dome = (x) => {
    const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)))
    return y0 - rise * Math.sin(Math.PI * Math.pow(t, 1.14))
  }
  // The warp mouths are deliberately meaner than the 13 mm legal ceiling. At the
  // full 13 mm they swallowed 29% of every ball put on the board, which made the
  // stage route — and therefore the start pocket — about three times as generous
  // as a real machine's base rate. 11.7 mm leaves 0.7 mm of clearance per side.
  //
  // Since the roguelike this is a loadout dimension: WIDER WARPS opens it in
  // 2.8 mm steps. The roof spans are carved around the mouth at build time, so
  // widening genuinely moves brass rather than just widening a sensor — a
  // sensor wider than its hole would score balls that bounced off the roof.
  const [warpLx, warpRx] = spec.warps
  const warpMouth = L.warpMouth
  const hw = clearHalf(warpMouth)
  const roofSpan = (from, to) => {
    const N = 14
    for (let i = 0; i < N; i++) {
      const a = from + (to - from) * (i / N)
      const b = from + (to - from) * ((i + 1) / N)
      seg(a, dome(a), b, dome(b))
    }
  }
  roofSpan(x0, warpLx - hw)
  roofSpan(warpLx + hw, warpRx - hw)
  roofSpan(warpRx + hw, x1)
  const roofY = dome, roofYR = dome

  // Sides and rounded bottom corners.
  seg(x0, y0, x0, y1 - rr)
  seg(x1, y0, x1, y1 - rr)
  seg(x0 + rr, y1, x1 - rr, y1)
  for (let i = 0; i < 6; i++) {
    const a0 = Math.PI / 2 * (i / 6), a1 = Math.PI / 2 * ((i + 1) / 6)
    seg(x0 + rr - Math.cos(a0) * rr, y1 - rr + Math.sin(a0) * rr,
      x0 + rr - Math.cos(a1) * rr, y1 - rr + Math.sin(a1) * rr)
    seg(x1 - rr + Math.cos(a0) * rr, y1 - rr + Math.sin(a0) * rr,
      x1 - rr + Math.cos(a1) * rr, y1 - rr + Math.sin(a1) * rr)
  }
  parts.housing = { x0, y0, x1, y1, rr, dome, rise }

  // Warp gates (ワープ) on the housing shoulders. A ball swallowed here is
  // delivered to the stage (ステージ), a shelf under the display that dribbles it
  // out right above the heso — enormously improving its odds. A designed shortcut
  // that feels like luck; the board's clearest piece of manufactured near-agency,
  // so it stays. machine.js re-spawns the ball on the stage.
  parts.sensors.warpL = world.addSensor('warp', warpLx, roofY(warpLx) + 0.004, warpMouth, 0.012, 'warpL')
  parts.sensors.warpR = world.addSensor('warp', warpRx, roofYR(warpRx) + 0.004, warpMouth, 0.012, 'warpR')
  // Where the stage spits a warped ball back out. On a motif board it follows
  // the housing's foot and centres on the motif's heso — the stage-over-heso
  // law is what makes a warp feel lucky, and validateMotifBoard enforces it.
  parts.stage = motif
    ? { x: motif.heso.x, y: y1, halfWidth: 0.030 }
    : { x: 0.220, y: 0.292, halfWidth: 0.030 }
  // The relocated readout, if the motif claims margin space for it. Stamped
  // here (null on the stock board) so the renderer's displayRect provider has
  // one source; the stock display keeps deriving from the housing rect.
  parts.displayRect = (motif && motif.displayRect) || null
}

function roundedRectPoints (x0, y0, x1, y1, r, seg) {
  const out = []
  const corner = (cx, cy, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg)
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
    }
  }
  corner(x1 - r, y0 + r, -Math.PI / 2, 0)
  corner(x1 - r, y1 - r, 0, Math.PI / 2)
  corner(x0 + r, y1 - r, Math.PI / 2, Math.PI)
  corner(x0 + r, y0 + r, Math.PI, Math.PI * 1.5)
  out.push(out[0])
  return out
}

// --- the nail field -------------------------------------------------------

function buildNailField (world, parts, L, motif = null) {
  if (motif) return motifNailField(world, parts, L, motif)
  const { housing } = parts
  // Reported nail counts vary widely — roughly 100 on modern LCD-dominated boards,
  // 500+ on early machines, with ~200 a commonly quoted modern figure. There is no
  // legal count; the statute regulates placement and material only. This field
  // lands at 107 after the wedge cull. The first pass left 86, which both looked
  // bare and gave balls too clean a run at the pockets.
  const pitchX = 0.0206
  const pitchY = 0.0188

  const usable = (x, y) => {
    if (Math.hypot(x - R.cx, y - R.cy) > CLEAR_R) return false
    // Clear of the housing, following the dome rather than its bounding box, so
    // the scatter field can sit close above the shoulders where it matters.
    if (x > housing.x0 - 0.013 && x < housing.x1 + 0.013 &&
        y > housing.dome(x) - 0.013 && y < housing.y1 + 0.013) return false
    if (y > 0.400) return false                       // leave the drain approach open
    return true
  }

  for (let row = 0; row < 24; row++) {
    const y = 0.066 + row * pitchY
    const off = (row % 2) ? pitchX / 2 : 0
    for (let col = 0; col < 24; col++) {
      const x = 0.026 + col * pitchX + off
      if (!usable(x, y)) continue
      // A lane down the middle beneath the housing, so balls can actually reach
      // the start pocket. In a parlour this corridor is what the nail technician
      // giveth and taketh away.
      if (Math.abs(x - 0.220) < 0.015 && y > housing.y1) continue
      // Keep the tulip mouths clear. (The wedge sweep also protects them, but
      // carving the hole up front keeps the approach lanes open.)
      if (Math.hypot(x - px(135, 0.140), y - py(135, 0.140)) < 0.028) continue
      if (Math.hypot(x - px(45, 0.140), y - py(45, 0.140)) < 0.028) continue
      parts.nails.push(world.addNail(x, y))
    }
  }

  // The inochi-kugi ("life nails"): the funnel directly above the start pocket.
  // The most consequential nails on any pachinko board. BOARD.hesoGap is the
  // clear span between their surfaces, so the centres sit half a gap plus one
  // nail radius apart. At the default 12.5 mm against an 11.0 mm ball that is
  // three quarters of a millimetre of clearance per side.
  //
  // Bending these is how parlours used to tune payout, and it is illegal — an
  // unauthorised modification under Article 9 of the Entertainment Business Act,
  // in the severity band that can suspend a licence. It was tolerated for decades
  // under the fiction that nails bend naturally through play; the National Police
  // Agency ended that tolerance in the 2015–16 crackdown and operators have been
  // referred for prosecution since. Worth knowing before a future builder
  // implements nail bending as a player verb.
  //
  // `L.hesoGap` is the clear span the loadout asks for. At stock it is the
  // regulated 12.5 mm; BEND THE LIFE NAILS opens it in the same 1.25 mm steps a
  // technician's plate gauge would. The nails themselves do not move in the
  // renderer's sense — they are placed here, once, at build time — so a run
  // that has bent them is a genuinely different board, not a modifier applied
  // to collision after the fact.
  const lnx = L.hesoGap / 2 + NAIL_R
  parts.lifeNails = [
    world.addNail(0.220 - lnx, 0.316, NAIL_R),
    world.addNail(0.220 + lnx, 0.316, NAIL_R)
  ]
  parts.nails.push(world.addNail(0.220 - 0.042, 0.302))
  parts.nails.push(world.addNail(0.220 + 0.042, 0.302))

  // The right-hand route: a sparse ladder of nails that catches balls coming
  // down the outer wall on the migi-uchi line and walks them into the attacker.
  // Marked as feature nails so the wedge sweep culls the regular grid around
  // them rather than removing them — an authored nail landing in a generated
  // field is exactly where nail-on-nail wedges appear.
  parts.featureNails = []
  for (let i = 0; i < 4; i++) {
    const a = 22 + i * 11
    const n = world.addNail(px(a, 0.176 - i * 0.004), py(a, 0.176 - i * 0.004))
    parts.nails.push(n)
    parts.featureNails.push(n)
  }
}

/**
 * The motif nail field — the 1970s move. Three populations:
 *
 *   THE CONTOUR: the image's traced silhouette, one nail per resampled point,
 *   emitted in trace order as ORDINARY nails. The wedge sweep may cull them —
 *   an authored nail is not a protected nail, and a contour that erodes at a
 *   pinch is a contour that was trapping balls (census rule: only functional
 *   nails join featureNails).
 *
 *   THE SPARSE GRID: the standard grid at a wider pitch, kept OUT of the
 *   silhouette (padded) so the picture reads as a shape in the field rather
 *   than a texture on it.
 *
 *   THE FUNCTIONAL BRASS: life nails at the motif's heso, its guide pair, and
 *   the stock right-route ladder (the attacker is rail furniture, and the
 *   rail is never a motif's — so its feed ladder isn't either).
 *
 * THE CORRIDOR is the one carve that makes an INTERIOR heso possible at all:
 * a lane of half-width motif.corridorHalf from the housing's foot to the
 * heso, kept clear of both grid and contour. On the tanuki it runs straight
 * down the face — a ball reaches the navel by way of the nose.
 */
function motifNailField (world, parts, L, motif) {
  const H = motif.housing
  const heso = motif.heso
  const pitchX = 0.0206 * motif.gridPitchMult
  const pitchY = 0.0188 * motif.gridPitchMult

  const inCorridor = (x, y) =>
    Math.abs(x - heso.x) < motif.corridorHalf && y > H.y1 - 0.004 && y < heso.y
  const usable = (x, y) => {
    if (Math.hypot(x - R.cx, y - R.cy) > CLEAR_R) return false
    if (y > 0.400) return false                       // the drain approach stays open
    if (x > H.x0 - 0.013 && x < H.x1 + 0.013 &&
        y > H.y0 - H.rise - 0.013 && y < H.y1 + 0.013) return false
    if (inCorridor(x, y)) return false
    for (const t of motif.tulips) if (Math.hypot(x - t.x, y - t.y) < 0.028) return false
    if (Math.hypot(x - heso.x, y - heso.y) < 0.026) return false
    return true
  }

  for (let row = 0; row < 24; row++) {
    const y = 0.066 + row * pitchY
    const off = (row % 2) ? pitchX / 2 : 0
    for (let col = 0; col < 24; col++) {
      const x = 0.026 + col * pitchX + off
      if (!usable(x, y)) continue
      if (inSilhouette(motif, x, y, 0.008)) continue
      parts.nails.push(world.addNail(x, y))
    }
  }

  for (const [x, y] of motif.contour) {
    if (!usable(x, y)) continue
    parts.nails.push(world.addNail(x, y))
  }

  // The brass flowers. Ordinary nails — legal by construction, but the sweep
  // still gets the last word if one lands near a wall.
  for (const r of motif.rosettes || []) {
    for (const [x, y] of rosetteNails(r)) {
      if (!usable(x, y) || inSilhouette(motif, x, y, 0.006)) continue
      parts.nails.push(world.addNail(x, y))
    }
  }

  // The life nails, exactly the stock construction, at the motif's heso.
  const lnx = L.hesoGap / 2 + NAIL_R
  parts.lifeNails = [
    world.addNail(heso.x - lnx, heso.y - 0.006, NAIL_R),
    world.addNail(heso.x + lnx, heso.y - 0.006, NAIL_R)
  ]
  parts.nails.push(world.addNail(heso.x - 0.042, heso.y - 0.020))
  parts.nails.push(world.addNail(heso.x + 0.042, heso.y - 0.020))

  parts.featureNails = []
  for (let i = 0; i < 4; i++) {
    const a = 22 + i * 11
    const n = world.addNail(px(a, 0.176 - i * 0.004), py(a, 0.176 - i * 0.004))
    parts.nails.push(n)
    parts.featureNails.push(n)
  }
}

// --- windmills, tulips ----------------------------------------------------

function buildFurniture (world, parts, L, motif = null) {
  // Windmills (風車, kazaguruma). Brass axle, same hardness spec as the nails.
  parts.rotors.push(world.addRotor(0.082, 0.238, 0.0225, 4, 0))
  parts.rotors.push(world.addRotor(0.358, 0.238, 0.0225, 4, 0))

  // Powered tulips (電動チューリップ, denchū). Closed, the mouth obeys the 13 mm
  // prize-pocket cap; open, it may reach 55 mm and no more, for at most six
  // seconds per activation.
  // Sited at radius 0.140 from the rail centre, not 0.160. Any structure out
  // near the rail creates a gap that *converges* — wide at the top, pinched at
  // the bottom — and somewhere along it the clear span passes through exactly
  // one ball diameter. That is an infallible trap, and it caught a third of
  // every ball on the board. The nail sweep cannot help here: you cannot cull a
  // wall. Keep large furniture well inboard, and run tools/board-audit.js.
  //
  // STUCK TULIPS wires them open at build time and leaves them there. It is the
  // one part that changes where EVERY ball on the board ends up rather than
  // adding another place for a few of them to stop — two fifty-millimetre
  // mouths in the middle of the scatter field are a different playfield, not a
  // better one, and the wedge sweep below sees them in their open pose because
  // that is the pose they will spend the run in.
  // A motif sites the tulips on its image's features (ids keep the stock
  // vocabulary — positions move, organs never change name).
  const tulipSpec = (motif && motif.tulips) || [
    { id: 'tulipL', x: px(135, 0.140), y: py(135, 0.140) },
    { id: 'tulipR', x: px(45, 0.140), y: py(45, 0.140) }
  ]
  for (const t of tulipSpec) parts.tulips.push(makeTulip(world, t.id, t.x, t.y, L))
}

function makeTulip (world, id, x, y, L) {
  // Closed, the clear mouth is a hair over one ball wide, so a closed tulip
  // takes balls only rarely. Open, it reaches 50 mm — our choice, inside the
  // regulated 55 mm ceiling.
  const halfMouth = clearHalf(L.tulipClosedMouth, 0.0018)
  const wingLen = 0.024
  const tulip = { id, x, y, open: !!L.stickyTulips, sticky: !!L.stickyTulips, t: 0, halfMouth, wingLen }
  tulip.maxSpread = Math.asin(Math.min(1, (L.tulipMouth / 2 - halfMouth) / wingLen))
  tulip.segL = world.addSegment(x - halfMouth, y, x - halfMouth, y - wingLen, 0.0018, MAT.wall, id + '-L')
  tulip.segR = world.addSegment(x + halfMouth, y, x + halfMouth, y - wingLen, 0.0018, MAT.wall, id + '-R')
  tulip.segL.dynamic = tulip.segR.dynamic = true      // wings move; keep out of the static grid
  // The cup below the mouth. Without it the sensor is a bare rectangle in open
  // space and balls stroll in from the side — narrowing the mouth then does
  // nothing at all, which is exactly what the first calibration run showed.
  // A pocket has to be a pocket.
  const d = 0.016
  world.addSegment(x - halfMouth, y, x - halfMouth, y + d, 0.0018, MAT.wall, id + '-cupL')
  world.addSegment(x + halfMouth, y, x + halfMouth, y + d, 0.0018, MAT.wall, id + '-cupR')
  world.addSegment(x - halfMouth, y + d, x + halfMouth, y + d, 0.0018, MAT.wall, id + '-cupB')
  tulip.sensor = world.addSensor('tulip', x, y + d * 0.6, halfMouth * 1.6, 0.010, id)
  // Snap the wings to their resting pose before the wedge sweep runs, so the
  // sweep audits the geometry the run will actually be played on. `applyTulip`
  // is a first-order chase whose rate clamps at 1, so dt = 1 lands exactly on
  // the target rather than approaching it.
  applyTulip(tulip, 1)
  return tulip
}

/** Animate a tulip's wings toward its open/closed target. Called from machine.js. */
export function applyTulip (tulip, dt) {
  const target = tulip.open ? 1 : 0
  tulip.t += (target - tulip.t) * Math.min(1, dt * 12)
  const spread = tulip.maxSpread * tulip.t
  const { x, y, halfMouth, wingLen } = tulip
  const sl = Math.sin(spread), cl = Math.cos(spread)
  tulip.segL.ax = x - halfMouth; tulip.segL.ay = y
  tulip.segL.bx = x - halfMouth - sl * wingLen
  tulip.segL.by = y - cl * wingLen
  tulip.segR.ax = x + halfMouth; tulip.segR.ay = y
  tulip.segR.bx = x + halfMouth + sl * wingLen
  tulip.segR.by = y - cl * wingLen
}

// --- pockets --------------------------------------------------------------

function buildPockets (world, parts, L, motif = null) {
  // The start pocket — 始動口 (shidōguchi), universally called ヘソ, "the navel".
  // Landing here does NOT pay meaningfully; it triggers the digital lottery. The
  // gap between "the ball went in" and "you won" is the single most important
  // fact about modern pachinko, and this game says it out loud.
  // Same lesson as the tulips: the heso is a cup, not a floating rectangle. The
  // only way in is down through the life nails.
  const hx = motif ? motif.heso.x : 0.220
  const hy = motif ? motif.heso.y : 0.322
  const hhw = clearHalf(BOARD.mouthClosed, 0.0018), hd = 0.016
  world.addSegment(hx - hhw, hy, hx - hhw, hy + hd, 0.0018, MAT.wall, 'heso-L')
  world.addSegment(hx + hhw, hy, hx + hhw, hy + hd, 0.0018, MAT.wall, 'heso-R')
  world.addSegment(hx - hhw, hy + hd, hx + hhw, hy + hd, 0.0018, MAT.wall, 'heso-B')
  parts.sensors.chucker = world.addSensor('chucker', hx, hy + hd * 0.6, hhw * 1.6, 0.010, 'start')
  parts.heso = { x: hx, y: hy, hw: hhw, depth: hd }

  // The attacker (大入賞口, ōnyūshōkuchi) on the right-hand route, shut except
  // during a jackpot round. This is why migi-uchi exists — during ōatari you
  // crank the dial past the threshold and feed the right-hand line. Legally it
  // may open for up to 30 s per round, and no more than 1.8 s outside a jackpot.
  //
  // It is a hole in the bowl wall, and its flap is an arc of that same wall.
  // Closed, the boundary is unbroken and balls roll straight over it; there is
  // no ledge and no crevice. Earlier drafts hung the flap in front of the wall
  // and left an eleven-millimetre slot behind it — which is, to the nearest
  // tenth of a millimetre, the width of a pachinko ball. It caught 391 per run.
  // Sited at 318°, upstream of the return rubber, because that is where a
  // migi-uchi ball actually is: still pinned to the outer wall on its way round.
  // Placed downstream (the first attempt put it at 30°) the rubber has already
  // flung the ball inward across the field and the attacker starves — thirteen
  // jackpots returned barely a third of the balls they should have.
  const AT = 318
  const halfAngle = (BOARD.mouthAttacker / 2) / R.r / D2R
  const a0 = AT - halfAngle, a1 = AT + halfAngle
  const flap = []
  for (let a = a0; a < a1 - 1e-9; a += (a1 - a0) / 8) {
    const b = Math.min(a1, a + (a1 - a0) / 8)
    flap.push(world.addSegment(px(a, R.r), py(a, R.r), px(b, R.r), py(b, R.r),
      0.0018, MAT.wall, 'attacker-flap'))
  }
  // The catch basin sits just outside the wall; a ball only reaches it when the
  // flap is down.
  const ax = px(AT, R.r + 0.014), ay = py(AT, R.r + 0.014)
  parts.sensors.attacker = world.addSensor('attacker', ax, ay, 0.046, 0.046, 'attacker')
  parts.sensors.attacker.open = false
  parts.attacker = {
    x: px(AT, R.r), y: py(AT, R.r), a0, a1, angle: AT,
    flap, sensor: parts.sensors.attacker, open: false, t: 0
  }

  // Out holes: everything that failed. Most balls end here — that is the game.
  const og = BOARD.bowlGap
  parts.sensors.out = world.addSensor('out', px(90, R.r), py(90, R.r) + 0.004,
    Math.abs(px(og[1], R.r) - px(og[0], R.r)) + 0.02, 0.022, 'out')

  // The foul catch, sitting in the channel just above the foul stop.
  const fa = BOARD.railStart - 2
  parts.sensors.foul = world.addSensor('foul', px(fa, R.r - R.gap / 2), py(fa, R.r - R.gap / 2),
    0.014, 0.014, 'foul')
}

// --- buckets --------------------------------------------------------------

/**
 * Scoring buckets: the Peggle end of this machine.
 *
 * A bucket is a cup with a sensor in it. Structurally it is the heso with the
 * lottery taken out — a ball that lands in one is worth POINTS, immediately,
 * with no verdict in between. That contrast is the reason the roguelike layer
 * belongs on this particular board rather than fighting it: the whole original
 * argument was that the start pocket does not pay you, and now there are seven
 * mouths on the field that visibly do, so the player can feel the difference
 * between the honest prize and the lottery ticket in the same session.
 *
 * ── the three things that will kill you here ──
 *
 * 1. A CUP MUST BE A CUP. A bare sensor rectangle in open space lets balls
 *    stroll in from the side, and narrowing the mouth then changes nothing at
 *    all — which is exactly what the tulips' first calibration run showed. Two
 *    walls and a floor, every time.
 *
 * 2. THE FLOOR MUST BE DEEP ENOUGH. The sensor sits mid-cup; if the cup is
 *    shallower than a ball diameter the ball rests with its equator above the
 *    rim and can be knocked out by the next one, which reads as a bucket that
 *    randomly refuses to score. Depth is 16 mm against an 11 mm ball.
 *
 * 3. THE RIM IS AN UPWARD-FACING SURFACE. Every one of those on this board has
 *    to shed (see buildHousing). The walls are 2.2 mm segments — capsules, so
 *    the rim is a cylinder, and a ball cannot balance on a cylinder for the
 *    same reason it cannot balance on a nail. Do not be tempted to cap them
 *    with a flat plate.
 */
function buildBuckets (world, parts, L) {
  const mouth = L.bucketMouth
  const hw = clearHalf(mouth, 0.0018)
  const depth = 0.016

  // A motif owns its site table (same NAMES — the vocabulary law — different
  // positions, cleared against the motif's own furniture). The gate audits
  // whichever table the board actually uses.
  const TABLE = (parts.motif && parts.motif.bucketSites) || BUCKET_SITES
  for (const b of L.buckets) {
    const site = TABLE[b.site]
    if (!site) continue
    const { x, y } = site
    // Sited furniture must stay inboard of the launch channel, the same rule
    // that put the tulips at radius 0.140 instead of 0.160. A bucket whose
    // outer wall crosses CLEAR_R makes a converging gap against the rail, and a
    // converging gap passes through exactly one ball diameter somewhere along
    // its length. That is an infallible trap and no sweep can remove a wall.
    if (Math.hypot(x - R.cx, y - R.cy) + hw > CLEAR_R) {
      throw new Error(`bucket site "${b.site}" at (${x}, ${y}) fouls the launch channel ` +
        `at mouth ${(mouth * 1000).toFixed(1)} mm`)
    }
    const id = 'bucket-' + b.site
    world.addSegment(x - hw, y, x - hw, y + depth, 0.0018, MAT.wall, id + '-L')
    world.addSegment(x + hw, y, x + hw, y + depth, 0.0018, MAT.wall, id + '-R')
    world.addSegment(x - hw, y + depth, x + hw, y + depth, 0.0018, MAT.wall, id + '-B')
    const sensor = world.addSensor('bucket', x, y + depth * 0.6, hw * 1.6, 0.010, b.site)
    parts.buckets.push({ site: b.site, x, y, hw, depth, value: b.value, sensor })
  }
}

/** Open/close the attacker gate. */
export function applyAttacker (att, dt) {
  const target = att.open ? 1 : 0
  att.t += (target - att.t) * Math.min(1, dt * 14)
  const down = att.t > 0.55
  for (const s of att.flap) s.disabled = down
  att.sensor.open = down
}

export { makeBall, BALL_R }
