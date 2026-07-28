// The parts catalogue, and what a machine is made of.
//
// ── WHY A LOADOUT OBJECT AT ALL ─────────────────────────────────────────────
//
// The board used to be a constant. `buildBoard()` took nothing and returned the
// same 440 × 490 mm playfield every time, which was right while the project was
// arguing about one machine. A roguelike needs the board to be an *argument* —
// the run is a sequence of boards, each one the last board plus a part.
//
// So this file is the single source of truth for what a machine has on it, and
// `buildBoard(loadout)` is the only consumer. Two rules keep it honest:
//
//   1. A loadout is DATA. It carries millimetres and multipliers, never colours,
//      sounds, or labels-for-the-player. (Labels live on the PART, which is a
//      catalogue entry, not a board fact.) Design law L4 survives the roguelike
//      only if the geometry layer still cannot see the presentation layer.
//
//   2. Every dimension in here is a CLEAR SPAN in metres, matching board.js's
//      convention, because the wedge — a gap wider than nothing and narrower
//      than an 11 mm ball — is this board's characteristic failure and the only
//      defence against it is that every width in the codebase means the same
//      thing. `tools/loadout-audit.js` re-runs the trap sweep against a few
//      hundred random loadouts precisely because parts multiply the number of
//      possible boards past what anyone can check by eye.
//
// ── WHY WIDTHS ARE A PART AND NOT A DIFFICULTY SLIDER ───────────────────────
//
// The most consequential number on a real pachinko board is the clear span
// between the two life nails: 11.25–12.50 mm against an 11.00 mm ball, adjusted
// in quarter-millimetre steps, and the difference between a parlour making money
// and losing it. Bending those nails is how operators used to tune payout, and
// it is illegal (see board.js).
//
// This game hands it to the player as an upgrade, which is a deliberate joke
// with a real edge: the roguelike's fantasy is being allowed to do the thing the
// National Police Agency spent 2015–16 prosecuting people for. The widths are
// real, the effect on the economy is measured rather than asserted, and
// tools/calibrate.js will tell you exactly how much of a criminal you have
// become.

import { BOARD } from './board-consts.js'

// ── bucket sites ────────────────────────────────────────────────────────────
//
// A bucket is a cup with a sensor in it: the Peggle end of this machine, where
// a ball is worth points rather than a lottery ticket. Sites are fixed
// positions, not free placement, for two reasons — free placement would let a
// player build a wedge the audit could not anticipate, and a fixed site set
// means the same part always produces the same board, which is what makes a run
// reproducible from a seed.
//
// Every site is checked against three constraints when it is added:
//   * inside CLEAR_R of the rail centre, or it fouls the launch channel
//   * clear of the housing and of the heso cup
//   * far enough from its neighbours that two adjacent buckets cannot form a
//     pinch between their outer walls
//
// `tools/loadout-audit.js` enforces all three against the real geometry rather
// than trusting the numbers below, because the numbers below are hand-placed
// and hand-placed numbers in this file have been wrong before.
//
// These coordinates are MEASURED FREE SPACE, not taste. The first set was
// placed by eye across the lower field and every one of them failed: the two
// powered tulips sit at (0.121, 0.345) and (0.319, 0.345), which is exactly the
// middle of where "the lower field" intuitively seems empty, and a widened cup
// anywhere near one converges against its wing or its cup wall at 11–12 mm.
//
// The replacement set came out of a position probe — build the board with one
// bucket at every (x, y) on a grid, at the WIDEST mouth a part can reach, and
// keep only the cells with no pinch, no windmill conflict, and a live path from
// the open field to the rim. Three free regions survive: the outer flanks above
// the tulips, the floor beneath them, and the right shoulder.
//
// If a future builder moves a tulip, or adds furniture, these are wrong again,
// and `node tools/loadout-audit.js` is what will say so.
//
// `value` is a per-site score multiplier, and it is the second thing on this
// board that is set by measurement rather than by taste.
//
// `node tools/run-sim.js --sites` fires balls at a fully-bucketed board and
// counts what arrives where. Over 16 floors it read: eastDeep 33%, eastHigh
// 21%, westLow 17%, centre 16%, eastLow 8%, westDeep 6% — a five-fold spread
// across six mouths, which is not a flaw. The two routes are not mirror images
// (a right-route ball rides the outer wall down the far side; a left-route ball
// falls inward at the threshold and rains down the middle), so the board is
// genuinely asymmetric and any bucket set laid out symmetrically will be too.
//
// The values invert that spread, gently — enough that a starved site is worth
// drafting, not so much that position stops mattering. A hard-to-feed mouth
// paying more is also just correct: it is the one thing on this board a player
// can deliberately aim for.
export const BUCKET_SITES = {
  westLow: { x: 0.086, y: 0.284, jp: '左', label: 'WEST', value: 1.5 },
  eastLow: { x: 0.354, y: 0.284, jp: '右', label: 'EAST', value: 2.2 },
  westDeep: { x: 0.166, y: 0.376, jp: '左下', label: 'WEST FLOOR', value: 2.5 },
  eastDeep: { x: 0.274, y: 0.376, jp: '右下', label: 'EAST FLOOR', value: 1 },
  centre: { x: 0.220, y: 0.390, jp: '中', label: 'THE DROP', value: 1.5 },
  // The shoulder sits further out than it looks like it needs to. At 0.350 the
  // widened cup's bottom corner is 11.6 mm from the housing's side wall — not a
  // face-to-face pinch, a DIAGONAL one into the nook under the corner, which is
  // the shape the position probe missed because it sampled every 8 mm and
  // 0.220 fell between two rows. Nudging it inward is worse, not better: the
  // perpendicular gap passes THROUGH the trap band on the way to being safely
  // wide.
  eastHigh: { x: 0.350, y: 0.216, jp: '右上', label: 'EAST SHOULDER', value: 1.4 }
}

// ── THERE IS NO SEVENTH SITE, AND THAT IS A MEASUREMENT ─────────────────────
//
// There was a westHigh, mirroring eastHigh at (0.090, 0.216). It passed every
// geometry check: no pinch at any widening step, a clear descent above its
// mouth, comfortably inside the launch channel. It scored ZERO across 16 full
// floors and 126 bucket entries — not rarely, never.
//
// The reason is the same asymmetry the values above are pricing. A right-route
// ball rides the outer wall all the way round and comes down the far right,
// straight past a right shoulder. A left-route ball falls inward at the
// threshold — up at 250°, near (0.156, 0.071) — and rains down the MIDDLE.
// Nothing on this board delivers a ball to the upper-left flank, so a mouth
// there is a hole in a wall nobody walks past.
//
// A probe of the whole lower band with the other six already fitted found no
// clean replacement either: they crowd each other, and every candidate came
// back with a pinch. So the board holds six scoring cups, not seven, and the
// honest thing is to ship six rather than to sell a player a draft pick for a
// mouth that will never see a ball. `blockedPockets` in tools/lib/pinch.js
// deliberately refuses to guess at this question; `--sites` is what answers it,
// and it should be re-run after any change to the routes or the furniture.
/**
 * Order buckets are handed out in, so a run's boards grow predictably.
 *
 * The flanks come first because they are the sites a ball reaches on the way
 * DOWN from either route, which means the first bucket a player is given works
 * with the dial setting they already understand. The shoulder comes last: it is
 * the hardest to feed and the most satisfying when a board finally can.
 */
export const SITE_ORDER = ['westLow', 'eastLow', 'westDeep', 'eastDeep', 'centre', 'eastHigh']

// A bucket's mouth. The regulated prize-pocket ceiling is 13 mm and the stock
// bucket sits exactly on it; every widening step past that is the player being
// handed a machine no inspector would pass, which is the point.
export const BUCKET_MOUTH = 0.013
export const BUCKET_WIDEN_STEP = 0.0055
// Hard ceiling on a widened mouth. Not a balance number — a geometry one.
//
// The first draft allowed 42 mm, which the loadout sweep rejected outright: a
// cup that wide has walls 24 mm out from its centre, and there is no placement
// of seven of them on a 440 mm field that keeps every one of those walls both
// clear of the launch rail and far enough from its neighbours. 29.5 mm fits,
// with the widest site pair's outer walls 21 mm apart — comfortably above the
// trap band rather than skirting it.
//
// This is the honest version of a balance decision: the number came from
// tools/loadout-audit.js refusing to go higher, not from taste.
export const BUCKET_MOUTH_MAX = 0.0295

/**
 * The base machine: what you get with no parts at all.
 *
 * Two buckets, because a board with none is not a scoring machine — it is the
 * original simulator, where the only way to move a number is the lottery, and a
 * run measured in a few hundred balls would end 1-in-99 times in anything at
 * all happening. The stock pair is the floor the difficulty curve is measured
 * against (see tools/run-sim.js).
 */
export function baseLoadout () {
  return {
    // geometry, all clear spans in metres
    buckets: [
      { site: 'westLow', value: BUCKET_SITES.westLow.value, widen: 0 },
      { site: 'eastLow', value: BUCKET_SITES.eastLow.value, widen: 0 }
    ],
    bucketMouth: BUCKET_MOUTH,
    hesoGap: BOARD.hesoGap,
    tulipMouth: BOARD.mouthTulip,
    tulipClosedMouth: 0.0113,
    warpMouth: 0.0117,
    attackerMouth: BOARD.mouthAttacker,
    stickyTulips: false,
    rubberNails: false,

    // scoring, all pure multipliers
    scoreMult: 1,
    bucketScore: 1,
    hesoScore: 1,
    comboStep: 0.10,
    comboWindow: 3.2,
    comboCap: 40,

    // the run's economy
    //
    // `ballRefund` is the fraction of every ball PAID OUT that becomes another
    // launch. It is zero at stock, and that is the whole reason the floors have
    // a clock at all: the machine's tray refills constantly from its own
    // pockets, and an early build let that feed the launcher directly. Floors
    // stopped ending. The measured cost-to-clear at floor 8 was 746% of the
    // allowance — the tray was outrunning the launcher and a "160-ball floor"
    // was really a 1,200-ball grind. Balls have to be a clock or they are
    // nothing, so the connection between the tray and the clock is now a PART,
    // and turning it all the way on is a decision the player makes on purpose.
    ballRefund: 0,
    ballBonus: 0,
    quotaRelief: 0,

    // bookkeeping — which parts produced this loadout
    parts: []
  }
}

// ── the catalogue ───────────────────────────────────────────────────────────
//
// Each part is a pure function from a loadout to the same loadout, mutated.
// `weight` is the draw weight; `max` is how many times a part may be taken.
//
// The difficulty curve the operator asked for — "much harder at first, then
// increasingly easy to get absurdly high scores" — is not a scaling constant
// anywhere in this file. It is the shape that falls out of these parts being
// MULTIPLICATIVE against a quota that is merely GEOMETRIC. A part that adds a
// bucket raises the rate of scoring events; a part that raises the combo step
// raises the value of each one; a part that widens mouths raises both. Three
// parts of each kind multiply into roughly 8× while the quota has grown 6×, and
// past that point the curves separate and never meet again.
//
// That is the intended behaviour and it is measured, not hoped: run
// `node tools/run-sim.js --curve` for the crossover floor at the current
// numbers. If a future builder retunes and the crossover moves past floor 9,
// the run stops being a power fantasy and becomes a wall.
export const PARTS = [
  // ── buckets: rate ──
  {
    id: 'bucket',
    name: 'ANOTHER BUCKET',
    jp: '入賞口増設',
    kind: 'geometry',
    weight: 26,
    max: 4,
    blurb: 'Bolt one more scoring pocket onto the field.',
    detail: 'The board holds six. They fill flanks, floor, centre, then the right shoulder — ' +
      'and the later ones pay more, because they are the ones the routes feed least. This is ' +
      'the only part that raises how OFTEN you score rather than how much.',
    apply (L) {
      const taken = new Set(L.buckets.map(b => b.site))
      const site = SITE_ORDER.find(s => !taken.has(s))
      if (!site) { L.bucketScore += 0.5; return }   // sold out — pays value instead
      L.buckets.push({ site, value: BUCKET_SITES[site].value, widen: 0 })
    },
    available: (L) => L.buckets.length < SITE_ORDER.length
  },
  {
    id: 'widen',
    name: 'WIDER MOUTHS',
    jp: '入賞口拡張',
    kind: 'geometry',
    weight: 22,
    max: 3,
    blurb: 'Every bucket mouth opens by 5.5 mm of clear span.',
    detail: 'The stock mouth is 13 mm against an 11 mm ball — the legal ceiling for a prize ' +
      'pocket, and two millimetres of margin. Each step past it is a machine no inspector passes.',
    apply (L) { L.bucketMouth = Math.min(BUCKET_MOUTH_MAX, L.bucketMouth + BUCKET_WIDEN_STEP) },
    available: (L) => L.bucketMouth < BUCKET_MOUTH_MAX - 1e-9
  },
  {
    id: 'lifenails',
    name: 'BEND THE LIFE NAILS',
    jp: '命釘開放',
    kind: 'geometry',
    weight: 15,
    max: 3,
    blurb: 'Open the funnel above the start pocket by 1.25 mm.',
    detail: 'The 命釘 are the two nails that decide a parlour\'s profit. Real boards run ' +
      '11.25–12.50 mm and are adjusted in quarter-millimetre steps. Bending them is the exact ' +
      'thing the National Police Agency stopped tolerating in 2015. More spins, more lottery.',
    apply (L) { L.hesoGap = Math.min(0.0210, L.hesoGap + 0.00125) },
    available: (L) => L.hesoGap < 0.0210 - 1e-9
  },
  {
    id: 'warp',
    name: 'WIDER WARPS',
    jp: 'ワープ拡張',
    kind: 'geometry',
    weight: 14,
    max: 3,
    blurb: 'The housing shoulders swallow more.',
    detail: 'A warped ball is carried to the stage and dribbled out directly above the start ' +
      'pocket. Measured, a warp lifts a ball\'s chance of a spin about eighteen-fold — the ' +
      'largest single edge on the board, and the one that feels most like luck.',
    apply (L) { L.warpMouth = Math.min(0.0230, L.warpMouth + 0.0028) },
    available: (L) => L.warpMouth < 0.0230 - 1e-9
  },
  {
    id: 'tulips',
    name: 'STUCK TULIPS',
    jp: 'チューリップ固定',
    kind: 'geometry',
    weight: 12,
    max: 1,
    blurb: 'Both powered tulips stay open. Permanently.',
    detail: 'A denchū may legally hold open for six seconds per activation. This one does not ' +
      'close. Fifty-millimetre mouths in the middle of the scatter field change where every ' +
      'ball on the board ends up.',
    apply (L) { L.stickyTulips = true },
    available: (L) => !L.stickyTulips
  },

  // ── scoring: value ──
  {
    id: 'mult',
    name: 'SCORE MULTIPLIER',
    jp: '倍率',
    kind: 'scoring',
    weight: 24,
    max: 8,
    blurb: 'Everything scores 40% more.',
    detail: 'Flat, dumb, and multiplicative — which is the whole trick. Quota grows by a fixed ' +
      'ratio each floor; this grows by a fixed ratio each time you take it, and you can take it ' +
      'more than once a floor.',
    apply (L) { L.scoreMult *= 1.4 }
  },
  {
    id: 'bucketvalue',
    name: 'HEAVY BUCKETS',
    jp: '入賞口加点',
    kind: 'scoring',
    weight: 20,
    max: 6,
    blurb: 'Buckets alone score 75% more.',
    detail: 'Narrower than the flat multiplier and larger. Worth more the more mouths you have ' +
      'bolted on, which is how two ordinary parts become one good engine.',
    apply (L) { L.bucketScore *= 1.75 }
  },
  {
    id: 'combostep',
    name: 'LONGER CHAINS',
    jp: '連鎖強化',
    kind: 'scoring',
    weight: 20,
    max: 6,
    blurb: 'Each link in a chain is worth +6% instead of +10%… of a bigger cap.',
    detail: 'Raises the per-link step AND the ceiling. A chain is every scoring event inside ' +
      'the window of the last one; it is the only number on the board that rewards having many ' +
      'balls in flight at once, which is what the fire-rate settings are for.',
    apply (L) { L.comboStep += 0.06; L.comboCap += 25 }
  },
  {
    id: 'combowindow',
    name: 'PATIENT CHAINS',
    jp: '連鎖持続',
    kind: 'scoring',
    weight: 16,
    max: 4,
    blurb: 'A chain survives 1.4 s longer without a scoring ball.',
    detail: 'At the regulation fire rate a chain is nearly impossible to hold. At STORM it is ' +
      'nearly impossible to drop. This part is what makes the slow, legal machine playable.',
    apply (L) { L.comboWindow += 1.4 }
  },
  {
    id: 'hesovalue',
    name: 'THE NAVEL PAYS',
    jp: 'ヘソ加点',
    kind: 'scoring',
    weight: 16,
    max: 4,
    blurb: 'The start pocket scores 2.2× more.',
    detail: 'The start pocket famously does not pay you — it buys a lottery ticket. This part ' +
      'is the game quietly conceding the point and paying you anyway.',
    apply (L) { L.hesoScore *= 2.2 }
  },

  // ── economy ──
  {
    id: 'balls',
    name: 'DEEPER TRAY',
    jp: '玉増量',
    kind: 'economy',
    weight: 22,
    max: 8,
    blurb: '+45 balls every floor from now on.',
    detail: 'Not a score part. Balls are the run\'s clock, and every other part is worth more ' +
      'with more of them — which makes this the one that looks weakest and compounds hardest.',
    apply (L) { L.ballBonus += 45 }
  },
  {
    id: 'refund',
    name: 'BALL RETURN',
    jp: '玉戻し',
    kind: 'economy',
    weight: 18,
    max: 4,
    blurb: 'A quarter of every ball paid out comes back as another launch.',
    detail: 'The floor\'s clock is LAUNCHES, and payouts do not normally touch it — a real ' +
      'tray refilling is not a real extension of your afternoon. This part connects the two. ' +
      'Stack all four and the machine returns every ball it pays: past that line a good floor ' +
      'stops having a limit, which is the single most dangerous part in the catalogue and ' +
      'deliberately so.',
    apply (L) { L.ballRefund = Math.min(1, L.ballRefund + 0.25) },
    available: (L) => L.ballRefund < 1 - 1e-9
  },
  {
    id: 'relief',
    name: 'SOFTER QUOTA',
    jp: '規定緩和',
    kind: 'economy',
    weight: 12,
    max: 3,
    blurb: 'Every floor\'s quota drops by 18%.',
    detail: 'The only part that touches the difficulty curve directly. It is deliberately the ' +
      'least interesting one in the catalogue — the run is supposed to be won by out-scaling ' +
      'the wall, not by lowering it.',
    apply (L) { L.quotaRelief = 1 - (1 - L.quotaRelief) * 0.82 }
  }
]

export const PART_BY_ID = Object.fromEntries(PARTS.map(p => [p.id, p]))

/**
 * Build a loadout from a list of part ids (repeats allowed, order irrelevant
 * except where a part's effect depends on what is already fitted).
 *
 * Pure and total: an unknown id is skipped rather than thrown on, because a save
 * written by an older build must still open. A run whose parts have been renamed
 * out from under it loses a part; it does not lose the save.
 */
export function resolveLoadout (partIds = [], base = null) {
  const L = base || baseLoadout()
  for (const id of partIds) {
    const p = PART_BY_ID[id]
    if (!p) continue
    p.apply(L)
    L.parts.push(id)
  }
  return L
}

/** How many of `id` are already fitted. */
export function countPart (L, id) {
  let n = 0
  for (const p of L.parts) if (p === id) n++
  return n
}

/** Can this part still be taken? Respects both `max` and its own predicate. */
export function partAvailable (L, part) {
  if (part.max && countPart(L, part.id) >= part.max) return false
  if (part.available && !part.available(L)) return false
  return true
}

/**
 * Draw `n` distinct part offers, weighted, from a seeded RNG.
 *
 * Takes the rng as an argument rather than making one, so the offers are part of
 * the run's deterministic stream and a run can be replayed from its seed. Never
 * offers the same part twice in one draft — a shop showing you the same
 * multiplier three times is a shop that wasted your choice.
 */
export function drawOffers (L, rng, n = 3) {
  const pool = PARTS.filter(p => partAvailable(L, p))
  const out = []
  const used = new Set()
  for (let k = 0; k < n && used.size < pool.length; k++) {
    let total = 0
    for (const p of pool) if (!used.has(p.id)) total += p.weight
    if (total <= 0) break
    let r = rng() * total
    for (const p of pool) {
      if (used.has(p.id)) continue
      r -= p.weight
      if (r <= 0) { used.add(p.id); out.push(p); break }
    }
  }
  return out
}
