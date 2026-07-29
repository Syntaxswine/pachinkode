// MOTIF BOARDS — layouts authored from an image, the 1970s way.
//
// The operator's design, from a Nishijin "Deluxe Super" reference photo: old
// machines printed a picture on the board and laid the brass out to MATCH it —
// nails outlining the artwork, pockets sitting on its features, the readout
// pushed into whatever space the picture left. This module is the SIM half of
// that idea: geometry only. The artwork itself registers renderer-side
// (registerMotifArt) so the Machine never carries an image — design law L4.
//
// A motif object is data, not code:
//   id           — keys the renderer's art registry
//   img          — where the picture sits, in board metres (the mapping frame
//                  every feature below was computed in)
//   contour      — the silhouette, traced from the image's alpha channel in
//                  the browser (Moore boundary walk, arc-length resampled to
//                  110 points) and committed here as data, the same
//                  authored-table pattern as ROUTE_ODDS
//   heso         — the start pocket's position
//   tulips       — wing pocket positions
//   housing      — the (small, relocated) housing: rect + warp mouth xs + rise
//   displayRect  — where the lottery readout draws, in the board's margins
//   corridorHalf — the half-width of the lane kept clear of nails above the
//                  heso, so an INTERIOR heso is reachable at all
//   minNails     — legality floor for the cabinet-builds test
//
// THE TANUKI (たぬき台): the operator's ball tanuki. The gift in this mapping
// is nominative: the game's start pocket is the ヘソ — the NAVEL — and here it
// sits on the tanuki's actual navel. Balls reach it down the corridor over the
// face. The tulips are the left paw and the tail's heart; the warps and their
// stage live in a small shrine roof above the head; the reels moved to the
// top-right margin, where the reference machine kept its rainbow arc (ours is
// mirrored — the chain meter already owns the top-left).

// The traced silhouette, normalized [0,1]² y-down (753×640 source).
const TANUKI_CONTOUR = [
  [0.0438, 0.5297], [0.0651, 0.4922], [0.0651, 0.4266], [0.0863, 0.3828],
  [0.1288, 0.3672], [0.1514, 0.325], [0.1554, 0.35], [0.1288, 0.3828],
  [0.17, 0.3969], [0.1912, 0.3937], [0.2218, 0.375], [0.2138, 0.3484],
  [0.2098, 0.3312], [0.1926, 0.3047], [0.1713, 0.2625], [0.1926, 0.2219],
  [0.2125, 0.1781], [0.2337, 0.1344], [0.2138, 0.0922], [0.2337, 0.0484],
  [0.2563, 0.0078], [0.2855, 0.025], [0.3001, 0.075], [0.3347, 0.05],
  [0.3904, 0.05], [0.4462, 0.05], [0.4117, 0.075], [0.3546, 0.075],
  [0.3201, 0.0984], [0.3612, 0.1141], [0.4104, 0.1234], [0.4475, 0.1453],
  [0.4781, 0.1734], [0.494, 0.2234], [0.5498, 0.2234], [0.595, 0.2375],
  [0.595, 0.3], [0.5896, 0.325], [0.5671, 0.3484], [0.5312, 0.375],
  [0.5525, 0.4156], [0.5803, 0.45], [0.6162, 0.425], [0.6375, 0.3828],
  [0.6162, 0.3438], [0.6375, 0.3484], [0.6707, 0.3766], [0.6813, 0.4313],
  [0.66, 0.4672], [0.7131, 0.4734], [0.749, 0.4984], [0.7875, 0.5172],
  [0.83, 0.5344], [0.8566, 0.5734], [0.8911, 0.5984], [0.8977, 0.6],
  [0.9323, 0.5734], [0.915, 0.5391], [0.8898, 0.5016], [0.8499, 0.4828],
  [0.7995, 0.475], [0.7649, 0.45], [0.7224, 0.4359], [0.7065, 0.4],
  [0.745, 0.3781], [0.7875, 0.3609], [0.834, 0.35], [0.8699, 0.375],
  [0.907, 0.4], [0.9429, 0.425], [0.9774, 0.4516], [0.9987, 0.4953],
  [0.9987, 0.5609], [0.9987, 0.6266], [0.9774, 0.6703], [0.9562, 0.7109],
  [0.9309, 0.7484], [0.8951, 0.7734], [0.8712, 0.8125], [0.8433, 0.8484],
  [0.7875, 0.85], [0.7517, 0.8734], [0.7145, 0.8984], [0.6587, 0.9],
  [0.6375, 0.9406], [0.6069, 0.9734], [0.571, 0.9984], [0.5153, 0.9984],
  [0.4582, 0.9984], [0.4728, 0.975], [0.4728, 0.9484], [0.4475, 0.9109],
  [0.4223, 0.9234], [0.3665, 0.9234], [0.3187, 0.9344], [0.2948, 0.9734],
  [0.259, 0.9984], [0.2032, 0.9984], [0.1474, 0.9984], [0.1076, 0.9781],
  [0.1501, 0.9625], [0.1248, 0.9234], [0.1076, 0.8781], [0.0651, 0.8609],
  [0.0465, 0.8234], [0.0226, 0.7844], [0.0027, 0.7438], [0.0013, 0.6781],
  [0, 0.6156], [0.0226, 0.575]
]

// The mapping frame. Height chosen so the feet fall just past the y=0.400
// drain band (their nails get culled, the art still shows them); x anchored
// so the NAVEL (image fraction 0.345, 0.70 — verified against the image with
// an overlay shot) lands on the board's centreline, where the corridor and
// the stage want it. The tail overshoots CLEAR_R on the right and its nails
// get culled too — the picture may exceed the brass; the brass may not
// exceed the field.
const IMG_H = 0.240
const IMG_W = IMG_H * (753 / 640)                    // 0.28237…
const NAVEL = [0.345, 0.70]
const IMG_X0 = 0.220 - NAVEL[0] * IMG_W              // 0.12258…
const IMG_Y0 = 0.190
const TX = (fx) => IMG_X0 + fx * IMG_W
const TY = (fy) => IMG_Y0 + fy * IMG_H

/**
 * Thin a contour to a minimum spacing. The traced points sit ~15.8 mm apart
 * in board metres, which is INSIDE the wedge sweep's kill band (a ball
 * squeezes at anything under ~14.6 mm centre-to-centre) — so an unthinned
 * contour ships to the sweep and comes back moth-eaten, the silhouette
 * eroding at whichever neighbour the emission order favoured. Thinning to a
 * legal spacing BEFORE the sweep keeps the shape's continuity and leaves the
 * sweep to judge only genuine conflicts (contour vs walls, cups, windmills).
 */
function thinContour (pts, minD = 0.0185) {
  const out = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minD) out.push(p)
  }
  return out
}

export const MOTIFS = {
  tanuki: {
    id: 'tanuki',
    label: 'たぬき台',
    img: { x: IMG_X0, y: IMG_Y0, w: IMG_W, h: IMG_H },
    contour: thinContour(TANUKI_CONTOUR.map(([fx, fy]) => [TX(fx), TY(fy)])),
    heso: { x: TX(NAVEL[0]), y: TY(NAVEL[1]) },      // (0.220, 0.358)
    // MEASURED LESSON (first sweep, 600 balls x 5 dials): a tulip placed ON
    // the image — the paw, the tail's heart — is a pocket walled off by its
    // own contour; both caught 0–2 balls in 3,000. A motif pocket must sit in
    // OPEN FIELD where the art points at it, not inside the art. These flank
    // the figure: beside the left paw, and under the tail's curl. Both well
    // inboard (radius ≤ 0.127) per buildFurniture's converging-gap law.
    tulips: [
      { id: 'tulipL', x: 0.115, y: 0.240 },
      { id: 'tulipR', x: 0.338, y: 0.272 }
    ],
    // The motif's own bucket-site table: the standard names (the vocabulary
    // law — run scoring and --sites key on them), repositioned where the
    // figure or the motif's furniture stood over the standard mouths. The
    // loadout-audit gate found every one of these the hard way: westLow under
    // tulipL's cup wall, eastLow pinched against tulipR, centre under the
    // relocated heso's own cup bottom.
    bucketSites: {
      westLow: { x: 0.086, y: 0.284, jp: '左', label: 'WEST', value: 1.5 },
      eastLow: { x: 0.320, y: 0.330, jp: '右', label: 'EAST', value: 2.2 },
      westDeep: { x: 0.166, y: 0.376, jp: '左下', label: 'WEST FLOOR', value: 2.5 },
      eastDeep: { x: 0.296, y: 0.376, jp: '右下', label: 'EAST FLOOR', value: 1 },
      // 'centre' keeps its NAME (code vocabulary — scoring and --sites key on
      // it) but lives in the open north-west field among the rosettes: the
      // navel took the drop's old spot, and a placement solver proved the
      // floor row cannot legally hold a third cup at max widen (every
      // candidate under the relocated heso pinched westDeep, eastDeep, or
      // the heso's own cup — measured, not guessed).
      centre: { x: 0.130, y: 0.180, jp: '花', label: 'THE FLOWER BED', value: 1.5 },
      eastHigh: { x: 0.350, y: 0.216, jp: '右上', label: 'EAST SHOULDER', value: 1.4 }
    },
    housing: { x0: 0.168, x1: 0.272, y0: 0.118, y1: 0.176, rise: 0.026, warps: [0.190, 0.250] },
    displayRect: { x0: 0.308, y0: 0.010, x1: 0.434, y1: 0.056 },
    corridorHalf: 0.022,
    // MEASURED LESSON (same sweep): a sparse field is not an aesthetic, it is
    // a geometry change. At 1.30× pitch the empty left margin became a clean
    // fall-lane from the crest back into the launch channel mouth — 66%
    // fouls at dial 0.20, 95%+ at low dials, where the stock board measures
    // ~0. Full stock density everywhere OUTSIDE the silhouette; the picture
    // reads by its carve and its outline, not by starving the field.
    gridPitchMult: 1.0,
    // Decorative nail rosettes in the open field — the reference machine's
    // little brass flowers. Petals at 16 mm from the centre: centre-to-petal
    // clear span 14.2 mm and petal-to-petal 18.8 mm, both past the wedge
    // sweep's kill band BY CONSTRUCTION, so a rosette that ships is a rosette
    // that was legal, not one the sweep happened to spare.
    rosettes: [
      { x: 0.085, y: 0.170 },
      { x: 0.055, y: 0.205 },
      { x: 0.338, y: 0.118 }
    ],
    minNails: 60
  }
}

/** A rosette's nail positions: one centre, five petals. */
export function rosetteNails (r) {
  const out = [[r.x, r.y]]
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / 5)
    out.push([r.x + Math.cos(a) * 0.016, r.y + Math.sin(a) * 0.016])
  }
  return out
}

/** Point-in-silhouette, in board metres. Ray cast against the mapped contour. */
export function inSilhouette (motif, x, y, pad = 0) {
  const pts = motif.contour
  // cheap pad: test the point and, if pad > 0, treat near-contour as inside
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  if (inside) return true
  if (pad > 0) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]
      const t = Math.max(0, Math.min(1,
        ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)))
      const dx = x - (ax + (bx - ax) * t); const dy = y - (ay + (by - ay) * t)
      if (dx * dx + dy * dy < pad * pad) return true
    }
  }
  return false
}
