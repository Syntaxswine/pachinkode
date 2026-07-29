// Colour, derived rather than chosen.
//
// Valdez & Mehrabian (1994), Journal of Experimental Psychology: General,
// 123(4), fit standardised regressions of emotional response on brightness (B)
// and saturation (S):
//
//     Pleasure  =  0.69·B  +  0.22·S
//     Arousal   = −0.31·B  +  0.60·S
//     Dominance = −0.76·B  +  0.32·S
//
// Two things in there are counterintuitive and both are load-bearing here.
// First, **saturation is the arousal driver** (+0.60), not brightness. Second,
// brightness is *negatively* related to arousal (−0.31) — a bright palette is
// pleasant but calming. So the maximally arousing image is DARK and SATURATED,
// which is, not coincidentally, what every casino floor looks like.
//
// Pachinkode inverts the equations: the dopamine model produces a target arousal,
// and this file solves for the (B, S) that delivers it. Colour is downstream of
// the model, which is the whole point of design law L2.
//
// Confidence note: these coefficients were verified against the published
// abstract and returned identically by independent exact-phrase searches, but
// the primary is paywalled and was never read directly. Treat as PARTIAL. If a
// future builder gets the paper, check them and update this comment.

export const VM = { pB: 0.69, pS: 0.22, aB: -0.31, aS: 0.60, dB: -0.76, dS: 0.32 }

/** The measured arousal of a (brightness, saturation) pair, on the VM scale. */
export const arousalOf = (B, S) => VM.aB * B + VM.aS * S
export const pleasureOf = (B, S) => VM.pB * B + VM.pS * S

/**
 * Solve for a (B, S) pair delivering the requested arousal.
 *
 * Arousal = −0.31·B + 0.60·S is one equation in two unknowns, so it needs a
 * second constraint. We hold brightness on a gentle downward path as arousal
 * rises — which is what the regression asks for, since brightness *fights*
 * arousal — and let saturation do the work.
 */
export function solveBS (arousal) {
  const B = 0.34 - 0.10 * arousal
  const S = (arousal + 0.31 * B) / 0.60
  return { B, S: Math.max(0, Math.min(1, S)) }
}

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)

/**
 * HSL → CSS, with saturation and lightness supplied by the model above.
 * `varnish` is the presentation switch: at 0 the hue collapses and only the
 * luminance survives, which is the same image with the dopamine layer removed.
 */
export function hsl (h, s, l, a = 1) {
  return `hsla(${((h % 360) + 360) % 360} ${clamp(s) * 100}% ${clamp(l) * 100}% / ${clamp(a)})`
}

/**
 * The palette for one frame.
 *
 * Everything a renderer needs, computed from the dopamine model's live state.
 * At varnish 0 every hue is stripped and every saturation is zero: the board
 * becomes a grey engineering drawing of itself. Nothing else changes — same
 * geometry, same balls, same outcomes.
 */
export function framePalette (dop, varnish = 1) {
  const v = clamp(varnish)
  const A = dop.arousal * v
  const { B, S: Svm } = solveBS(A)
  // The regression is standardised, so "zero arousal" is *average* arousal, not
  // absence of colour: solving arousal = −0.31B + 0.60S = 0 still returns S ≈ 0.18.
  // Correct for the model, wrong for this control — varnish 0 must mean the
  // dopamine layer is gone, so the final saturation is scaled by it outright.
  const S = Svm * v

  // Hue drifts with the prediction error: warm on a positive surprise, cold on
  // a negative one. Base is a cool slate — the resting colour of an unexcited
  // machine.
  const hue = 212 - clamp(dop.delta, -1, 1) * 190
  const ext = dop.extinction

  return {
    varnish: v,
    arousal: A,
    brightness: B,
    saturation: S,
    hue,
    /** Background: darkens and saturates as arousal climbs. */
    bg: hsl(hue + 6, S * 0.30, B * 0.16 * (1 - 0.25 * ext)),
    bgDeep: hsl(hue + 12, S * 0.38, B * 0.08),
    /** Board face. */
    board: hsl(hue, S * 0.22, B * 0.30 * (1 - 0.30 * ext)),
    boardEdge: hsl(hue, S * 0.30, B * 0.52),
    /** Brass nails desaturate and dim as the machine goes into extinction. */
    nail: hsl(44, (0.42 + 0.30 * A) * S * (1 - 0.55 * ext), (0.62 - 0.16 * ext) * (0.5 + B)),
    rail: hsl(hue + 4, S * 0.18, 0.30 + B * 0.35),
    housing: hsl(hue - 6, S * 0.26, B * 0.42),
    /** Chrome ball: mostly luminance, so it survives varnish 0 intact. */
    ball: `hsla(0 0% ${72 + 16 * A}% / 1)`,
    ballRim: hsl(hue + 20, S * 0.55, 0.86),
    /** Ink for the instrumentation. Deliberately quiet. */
    ink: hsl(hue, S * 0.10, 0.72),
    inkDim: hsl(hue, S * 0.08, 0.44),
    inkHot: hsl(hue - 170, S * 0.75, 0.66),
    /** The iris behind the field. */
    iris: hsl(hue - 8, S * 0.45, B * 0.22),
    pupil: hsl(hue - 4, S * 0.20, B * 0.05)
  }
}

/**
 * Colour for a ball trail, given the machine's learned value of where it is.
 *
 * This is the image the whole game is built around. The hue is V(s) — what the
 * machine currently believes a ball in that position is worth — and the alpha is
 * its confidence in that belief. Early in a session the board is a grey fog;
 * after a few hundred balls a bright thread appears above the start pocket,
 * because the machine learned it, not because anyone drew it.
 *
 * `value` is in tokens. A start-pocket entry is worth 11.7 (standard) to 21.5
 * (loose) depending on spec — three paid now plus a lottery ticket worth far
 * more — but no cell ever reaches that, because V is the
 * *average* return over every ball that passed through and most of them miss.
 * Measured over 3500 balls, the busiest cell in the funnel converges near 5.3.
 * Scaling to the theoretical 12 left the whole board in the cold third of the
 * ramp; scaling to what the machine actually learns is what makes the thread
 * legible. If a future builder changes the reward structure, re-measure this.
 */
const TRAIL_TOP = 5.5

// ── the score ramp ──────────────────────────────────────────────────────────
//
// A separate colour channel from everything above, and it is worth being clear
// about why, because this file's whole argument is that colour here is solved
// rather than chosen.
//
// `framePalette` codes the machine's INTERNAL STATE — arousal, prediction
// error — and it is solved from the Valdez & Mehrabian regressions because
// that state is an emotional claim and an emotional claim should be derived.
// The reward wash codes a BINARY EVENT (a ball was gained) and is therefore a
// single invariant hue, because that is how a conditioning cue works.
//
// This ramp codes a MAGNITUDE, which is neither. It is an instrument reading —
// the same job as a colour scale on a map — and the right property for that is
// monotone perceptual ordering, not derived affect. So the stops are ordered
// hot-to-hotter and the value is log-scaled, because scores in this game span
// four orders of magnitude between a stock floor and a maxed URAMONO one and a
// linear ramp would spend its entire range on the first floor.
//
// The one thing it inherits from the rest of the file is the law: at varnish 0
// the saturation is zero and the ramp collapses to a luminance ladder. The
// magnitude is still legible; the spectacle is gone. Same image, no lacquer.
const SCORE_STOPS = [
  { h: 48, s: 0.55, l: 0.72 },   // pale brass — a small pocket
  { h: 32, s: 0.85, l: 0.62 },   // orange
  { h: 8, s: 0.92, l: 0.60 },   // red
  { h: 330, s: 0.95, l: 0.64 },   // magenta
  { h: 286, s: 0.95, l: 0.70 },   // violet
  { h: 190, s: 1.00, l: 0.76 }    // cyan — absurd
]

/**
 * Where a score sits on the ramp, 0..1. Logarithmic between one bucket at
 * stock value and roughly what a maxed board pays for a single deep-chain hit.
 */
export function scoreTier (n) {
  const lo = Math.log(100), hi = Math.log(60000)
  return clamp((Math.log(Math.max(1, n)) - lo) / (hi - lo))
}

/** Colour for a score of magnitude `n`. `t` may be passed pre-computed. */
export function scoreColour (n, varnish = 1, alpha = 1, t = null) {
  const v = clamp(varnish)
  const u = clamp(t === null ? scoreTier(n) : t) * (SCORE_STOPS.length - 1)
  const i = Math.min(SCORE_STOPS.length - 2, Math.floor(u))
  const f = u - i
  const a = SCORE_STOPS[i], b = SCORE_STOPS[i + 1]
  // Interpolate along the shortest arc so 330 → 286 does not swing through green.
  let dh = b.h - a.h
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return hsl(a.h + dh * f, (a.s + (b.s - a.s) * f) * v,
    a.l + (b.l - a.l) * f, alpha)
}

// The value AXIS: one position function, one hue line. valueColour and
// rippleColour both derive from these two, which is what makes the
// cannot-drift claim below structural rather than wishful — retune the axis
// here and every rendering of V(s) moves together. (A review pass caught the
// first draft claiming this while rippleColour duplicated the literals.)
const valueT = (value) => clamp(value / TRAIL_TOP)
const valueHue = (t) => 214 - t * 176

/**
 * The learned-value ramp at a caller-owned alpha. Cold slate → warm gold as
 * expected value rises. The trails and the nail ripples both draw their hue
 * from the shared axis above, so the two ways the board paints its beliefs
 * cannot drift apart.
 */
export function valueColour (value, varnish = 1, alpha = 1) {
  const v = clamp(varnish)
  const t = valueT(value)
  return hsl(valueHue(t), (0.10 + 0.72 * t) * v, 0.42 + 0.30 * t, alpha)
}

export function trailColour (value, confidence, varnish = 1) {
  return valueColour(value, varnish, 0.15 + 0.55 * clamp(confidence))
}

/**
 * The nail ripples' rendering of the same axis — the shared `valueHue` line,
 * with a saturation and lightness floor the trails do not need. Measured on a
 * live board, the value map at struck nails runs 0–0.2 tokens early in a
 * session — at the trail ramp's 10% saturation floor a one-pixel ring is
 * indistinguishable from grey, which un-says the one thing the ring is for.
 * A trail is a continuous stroke and can afford to whisper; a ring cannot.
 * Only the floors differ — the hue is still the map's, cold slate at nothing
 * learned, gold over the funnel, and nobody chooses it.
 */
export function rippleColour (value, varnish = 1, alpha = 1) {
  const v = clamp(varnish)
  const t = valueT(value)
  return hsl(valueHue(t), (0.38 + 0.50 * t) * v, 0.55 + 0.20 * t, alpha)
}
