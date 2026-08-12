// Canvas 2D renderer.
//
// Reads the world, the parts, and the dopamine model. Writes pixels. It must
// never write back into any of them — the varnish-neutrality test depends on
// this file being a pure observer.
//
// The one image everything else serves: a ball's trail is coloured by V(s), the
// machine's learned estimate of what a ball in that position is worth, and its
// alpha by the machine's confidence in that estimate. When the ball lands, the
// gap between that estimate and what it actually paid is the prediction error —
// which drives the frame hue (palette.js) and the HUD's δ needle. The pocket
// flashes MARK those landings; their amplitude is authored per event class, not
// measured. (An earlier version of this comment claimed the flash WAS the δ.
// The audit disagreed, and the audit was right: the honest δ shrinks as the
// machine learns, and a monotonically dimming celebration is the opposite of
// what a flash is for. The measured signal lives in the hue and the needle.)

import { framePalette, trailColour, rippleColour, valueColour, hsl, scoreColour, scoreTier } from './palette.js'
import { BOARD, coinFlipDial, routeOdds } from '../sim/board.js'
import { WAVE, waveW } from '../sim/machine.js'
import { denomFor } from '../sim/run.js'
import { fmtScore } from '../format.js'

// Artwork registry for motif boards — RENDER-SIDE ONLY, keyed by motif id.
// The sim's motif objects carry geometry and never an image (design law L4;
// the varnish suite's banned-member regexes police the Machine, this registry
// is where the picture legally lives). Rect in board metres; alpha is the
// resting strength before the varnish rides it.
const MOTIF_ART = {}
export function registerMotifArt (id, spec) { MOTIF_ART[id] = { ...spec, img: null } }

const TAU = Math.PI * 2
const TRAIL_MAX = 26

export const EFFECTS_PROFILE = Object.freeze({
  full: Object.freeze({ motion: 1, flash: 1, lamps: 1, rewardWash: 1, shake: 1 }),
  reduced: Object.freeze({ motion: 0, flash: 0.18, lamps: 0.24, rewardWash: 0, shake: 0 })
})
export const effectsProfile = reduced => reduced ? EFFECTS_PROFILE.reduced : EFFECTS_PROFILE.full

/**
 * Where the marquee's forty-eight lamps sit, in board metres.
 *
 * A pure function rather than a loop buried in the draw call, because two
 * things about it have to stay checkable by a test rather than by eye:
 *
 *   1. NO LAMP MAY BE INSIDE THE RAIL. The side columns originally sat at
 *      x = 0.421 / 0.019 — |dx| = 0.201 from the rail centre, inside the outer
 *      wall at r = 0.206, and therefore inside the 20 mm launch channel. Six
 *      of the forty-eight were painted over every ball climbing to the top. A
 *      marquee is furniture on the CABINET; the field belongs to the steel.
 *   2. NO LAMP MAY COVER THE READOUT. A motif board moves its lottery display
 *      up into the top strip, and four of the top lamps landed inside it —
 *      lighting on the digits during a REACH, the one moment the player most
 *      needs to read them. The readout wins; a lamp that lands on it does not
 *      exist.
 *
 * See test/marquee.test.js, which asserts both against the real BOARD geometry
 * and every shipped motif rather than against copies of these numbers.
 */
export function marqueeLamps (displayRect = null) {
  const pos = []
  const top = 14, side = 10, bottom = 14
  for (let i = 0; i < top; i++) pos.push({ x: 0.022 + 0.396 * i / (top - 1), y: 0.023 })
  for (let i = 1; i <= side; i++) pos.push({ x: 0.433, y: 0.023 + 0.420 * i / (side + 1) })
  for (let i = bottom - 1; i >= 0; i--) pos.push({ x: 0.022 + 0.396 * i / (bottom - 1), y: 0.453 })
  for (let i = side; i >= 1; i--) pos.push({ x: 0.007, y: 0.023 + 0.420 * i / (side + 1) })
  const D = displayRect
  if (!D) return pos
  return pos.filter(p => !(p.x >= D.x0 - 0.004 && p.x <= D.x1 + 0.004 &&
                           p.y >= D.y0 - 0.004 && p.y <= D.y1 + 0.004))
}
export const effectsPhase = (phase, reduced) => reduced ? 0.5 : phase

// ── the route recorder (operator's design, 2026-07-28) ──────────────────────
// Every ball's COMPLETE path is recorded from launcher to pocket — invisibly.
// The playing game renders only the fading tail it always has; the full story
// lives in the data, bounded by the caps below, and becomes visible in ROUTE
// MODE (the R key) or readable by a harness via __pachinkode.routes(). "The
// colour just goes invisible — it's still there, just in the data."
const ROUTE_MAX_POINTS = 2400   // ~40 s of flight at 60 fps; a stuck ball stops growing
const ROUTE_LOG_MAX = 300       // completed routes kept for the harness
const ROUTE_DRAW_MAX = 60       // newest completed routes drawn in route mode
const ROUTE_CHUNK = 90          // points per colour chunk — per-segment colour at
                                // full length would be ~70k strokes a frame

export class Renderer {
  constructor (canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.trails = new Map()
    this.flashes = []
    this.popups = []           // floating payout numbers — the truth, dressed
    this.shake = 0
    this.lampPulse = 0         // heso burst on the frame lamps
    this.pulse = 0             // the reward wash — see rewardPulse()
    this.scorePops = []        // score numerals — the RUN's claim, not the ledger's
    this.ripples = []          // nail strikes, echoed in the value map's colour
    this.routeLog = []         // completed full routes — the invisible record
    this.fades = []            // dying visible tails, shrinking out
    this.testMode = false      // ROUTE MODE: render what was only recorded
    this.bucketFlare = new Map()  // site → 0..1, decays; pure lacquer
    this.bucketTier = new Map()   // site → last score tier, for its rim colour
    this._t = 0
    this._shownTokens = null   // the counter's displayed value, easing to truth
    this._tokGlow = 0
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    // The machine's licensed character. Real machines sell themselves on the
    // character that celebrates on the LCD during a jackpot — so this one has
    // a tanuki (operator-supplied art), drawn ONLY during a jackpot and only
    // under varnish: the character is the con's face, which makes it exactly
    // the thing the switch exists to remove. Guarded so the renderer still
    // constructs in a DOM-less harness.
    this.tanuki = typeof Image !== 'undefined' ? new Image() : null
    if (this.tanuki) this.tanuki.src = './images/tanuki-standing.png'
    // The jackpot ANIMATION (operator-supplied video): a muted, looping
    // <video> whose current frame is painted onto the LCD each draw — canvas
    // can drawImage a video element directly, so the LCD stays one surface.
    // Muted is what makes play() legal without a gesture. The standing PNG
    // above is the fallback while it buffers (or forever, headless).
    this.tanukiVid = typeof document !== 'undefined' ? document.createElement('video') : null
    if (this.tanukiVid) {
      const v = this.tanukiVid
      v.src = './images/tanuki-jackpot.mp4'
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'
    }
  }

  resize (cssW, cssH) {
    const dpr = this.dpr
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.cssW = cssW
    this.cssH = cssH
    // Fit the playfield plus the launcher cabinet, preserving aspect.
    const totalH = BOARD.h + BOARD.cabinetH
    this.scale = Math.min(cssW / (BOARD.w * 1.06), cssH / (totalH * 1.04))
    this.ox = (cssW - BOARD.w * this.scale) / 2
    this.oy = (cssH - totalH * this.scale) / 2
  }

  /** Board metres → canvas pixels. */
  X (x) { return this.ox + x * this.scale }
  Y (y) { return this.oy + y * this.scale }
  S (d) { return d * this.scale }

  flash (x, y, delta) { this.flashes.push({ x, y, d: delta, t: 0 }) }
  kick (amount) { this.shake = Math.min(1, this.shake + amount) }

  /**
   * A payout number, floated at the pocket that paid it. The number itself is
   * ledger truth and appears at every varnish; only the dressing (gold, rise,
   * pop-in) obeys the switch. Numbers going up, visibly, where and when the
   * scoring happened.
   */
  pop (x, y, text, weight = 1) { this.popups.push({ x, y, text, w: weight, t: 0 }) }

  /** A burst on the frame lamps — the board noticing a score. `k` is weight. */
  lampBurst (k = 1) { this.lampPulse = Math.max(this.lampPulse, Math.min(1, k)) }

  /**
   * The reward wash: a pulse of light through the whole room whenever a ball
   * is gained.
   *
   * This is a conditioning cue, built to the rules that make one work:
   *
   *   ONE INVARIANT. Always the same hue, at every tier. A cue is recognised
   *   by its constancy — varying the colour by payout would give the eye four
   *   weak cues instead of one strong one. Magnitude is carried by intensity
   *   and reach, never by hue.
   *
   *   NO FALSE POSITIVES. It is driven by the `pay` event, which is the
   *   ledger itself — so it structurally cannot fire unless `won` moved.
   *   Refunds deliberately do NOT reach it: a fouled ball coming back is a
   *   spend reversed, not a gain, and a cue that fires on both would be
   *   teaching a correlation the machine cannot honour.
   *
   *   NO STROBE. Pulses saturate rather than stack (a jackpot cascade lights
   *   the room and holds it lit instead of flickering), and the form is a
   *   slow edge bloom rather than a full-frame flash — in ordinary play this
   *   fires about 0.4 times a second, and that is a rate at which a hard
   *   flash would be unpleasant and a glow is not.
   *
   * Pure lacquer, so it obeys the switch completely: at varnish 0 there is no
   * wash at all, and the conditioning it builds gets no reinforcement. The
   * payout numbers keep appearing in ink — the information survives, the
   * training does not. That is the whole argument, applied to one more sense.
   */
  rewardPulse (n = 1) {
    // sqrt so +2 registers and +13 dominates without being six times louder.
    const w = Math.min(1, Math.sqrt(Math.max(0, n)) / 3.6)
    this.pulse = Math.min(1, this.pulse + w * (1 - this.pulse * 0.55))
  }

  /** Light a bucket up. `tier` is where its score sat on the ramp, 0..1. */
  bucketHit (site, tier = 0) {
    this.bucketFlare.set(site, 1)
    this.bucketTier.set(site, tier)
  }

  draw (machine, dop, varnish, dt, run = null, show = null, reducedEffects = false) {
    const ctx = this.ctx
    const P = framePalette(dop, varnish)
    const w = this.cssW, h = this.cssH
    const effects = effectsProfile(reducedEffects)

    ctx.save()
    ctx.scale(this.dpr, this.dpr)

    // Screen shake, scaled by varnish — it is presentation, so it obeys the switch.
    this.shake = Math.max(0, this.shake - dt * 2.6)
    if (this.shake > 0.001 && varnish > 0 && effects.shake > 0) {
      const k = this.shake * this.shake * 5 * varnish
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k)
    }

    this.background(ctx, P, w, h, dop)
    this.iris(ctx, P, dop)
    this.spectacleBack(ctx, P, show, w, h, reducedEffects)
    this.motifBackdrop(ctx, P, machine)
    this.boardFace(ctx, P)
    this.rail(ctx, P, machine)
    this.housing(ctx, P, machine)
    this.display(ctx, P, machine, dop)
    this.windmills(ctx, P, machine)
    this.nails(ctx, P, machine, dop)
    this.rippleLayer(ctx, P, dt)
    this.tulips(ctx, P, machine)
    this.temperBarLayer(ctx, P, machine)
    this.attacker(ctx, P, machine)
    this.pockets(ctx, P, machine, dop)
    // Buckets decay on the frame clock, before they are drawn, so a site that
    // scored this frame renders at full flare rather than one frame stale.
    for (const [k, v] of this.bucketFlare) {
      const n = v - dt / 0.55
      if (n <= 0) this.bucketFlare.delete(k); else this.bucketFlare.set(k, n)
    }
    this.buckets(ctx, P, machine)
    this.routeLayer(ctx, P)
    this.trailsAndBalls(ctx, P, machine, dop, dt)
    this.flashLayer(ctx, P, dt, effects)
    this.lamps(ctx, P, machine, dop, dt, effects)
    this.spectacleFront(ctx, P, show, reducedEffects, machine)
    this.popupLayer(ctx, P, dt)
    this.scorePopLayer(ctx, P, dt)
    this.chainMeter(ctx, P, run)
    this.quotaBar(ctx, P, run)
    this.launcher(ctx, P, machine)
    // Last, and additive: the room lighting up rather than a sheet over it.
    this.rewardWash(ctx, P, w, h, dt, effects)

    ctx.restore()
    this._t += dt
  }

  /** Broad rays behind the brass: scene-setting light, never ball information. */
  spectacleBack (ctx, P, show, w, h, reduced) {
    if (!show || show.intensity <= 0.01 || P.varnish <= 0.01) return
    const k = show.intensity * P.varnish * (reduced ? 0.24 : 1)
    const cx = this.X(BOARD.w / 2), cy = this.Y(0.245)
    const rays = reduced ? 6 : 16
    const phase = reduced ? 0 : (show.time || 0) * (show.pattern === 'chase' ? 1.8 : 0.55)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.translate(cx, cy)
    ctx.rotate(phase)
    for (let i = 0; i < rays; i++) {
      const a = TAU * i / rays
      const spread = reduced ? 0.035 : 0.018 + 0.012 * Math.sin(phase + i)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, Math.max(w, h) * 0.72, a - spread, a + spread)
      ctx.closePath()
      ctx.fillStyle = hsl((show.hue + i * (show.pattern === 'festival' ? 19 : 2)) % 360,
        P.saturation, 0.48, 0.028 * k)
      ctx.fill()
    }
    ctx.restore()
  }

  /**
   * Forty-eight marquee lamps around the live field. Patterns are continuous
   * chases and blooms rather than on/off strobes; reduced mode freezes their
   * travel and lowers the bloom while preserving the fact a scene is active.
   */
  spectacleFront (ctx, P, show, reduced, m = null) {
    if (!show || show.intensity <= 0.01 || P.varnish <= 0.01) return
    const pos = marqueeLamps(m && m.parts && m.parts.motif && m.parts.motif.displayRect)
    const N = pos.length
    const t = reduced ? 0.18 : (show.time || 0)
    const phase = effectsPhase(show.phase, reduced)
    // The comfort mode's published contract is 18–24%; the marquee is the
    // largest new light layer in the build and was running at 38%.
    const strength = show.intensity * P.varnish * (reduced ? EFFECTS_PROFILE.reduced.lamps : 1)
    for (let i = 0; i < N; i++) {
      const u = i / N
      let b = 0.25
      if (show.pattern === 'burst') b = 0.35 + 0.65 * Math.max(0, Math.sin(phase * Math.PI))
      else if (show.pattern === 'tunnel') b = 0.15 + 0.85 * Math.max(0, Math.cos(TAU * (u * 2 - t * 2.2))) ** 5
      else if (show.pattern === 'steps') b = ((i + Math.floor(t * 12)) % 4 === 0) ? 1 : 0.14
      else if (show.pattern === 'converge') b = 0.12 + 0.88 * Math.max(0, 1 - Math.abs(u - (0.5 - phase * 0.5)) * 6)
      else if (show.pattern === 'alternating') b = ((i + Math.floor(t * 4)) % 2) ? 0.9 : 0.18
      else if (show.pattern === 'wipe' || show.pattern === 'curtain') b = u <= phase ? 1 : 0.12
      else if (show.pattern === 'chase') b = 0.12 + 0.88 * Math.max(0, Math.cos(TAU * (u - t * 1.4))) ** 8
      else if (show.pattern === 'festival') b = 0.28 + 0.72 * Math.max(0, Math.sin(TAU * (u * 3 - t * 1.6))) ** 2
      const lit = Math.max(0, Math.min(1, b * strength))
      if (lit < 0.025) continue
      const x = this.X(pos[i].x), y = this.Y(pos[i].y)
      const r = Math.max(1.5, this.S(0.0036))
      const hue = (show.hue + (show.pattern === 'festival' ? i * 13 : 0)) % 360
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * (2 + lit * 2.5))
      g.addColorStop(0, hsl(hue, P.saturation * 1.2, 0.88, lit))
      g.addColorStop(0.28, hsl(hue, P.saturation, 0.60, lit * 0.7))
      g.addColorStop(1, hsl(hue, P.saturation, 0.45, 0))
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, r * (2 + lit * 2.5), 0, TAU); ctx.fill()
    }
  }

  /**
   * THE TEMPER BAR — the sweeping quench carriage (machine.js owns the
   * motion; this draws real state). The bar is NON-SOLID and the drawing says
   * so: an open frame with a glowing interior, not a wall. Varnish law: the
   * frame and its position are information (a player times launches to it)
   * and survive at varnish 0 as luminance; the ember glow is lacquer.
   */
  temperBarLayer (ctx, P, m) {
    const B = m.temperBar
    if (!B) return
    const bx = m.temperBarX
    const x0 = this.X(bx - B.halfW), x1 = this.X(bx + B.halfW)
    const y0 = this.Y(B.y - B.halfH), y1 = this.Y(B.y + B.halfH)
    // Carriage rail across the whole travel — faint, fixed.
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.2, 0.22)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(this.X(B.x0 - B.halfW), (y0 + y1) / 2)
    ctx.lineTo(this.X(B.x1 + B.halfW), (y0 + y1) / 2)
    ctx.stroke()
    // The ember interior — lacquer only.
    if (P.varnish > 0.01) {
      const g = ctx.createLinearGradient(x0, y0, x0, y1)
      g.addColorStop(0, `hsla(30 90% 55% / ${0.05 * P.varnish})`)
      g.addColorStop(0.5, `hsla(38 95% 60% / ${0.22 * P.varnish})`)
      g.addColorStop(1, `hsla(30 90% 55% / ${0.05 * P.varnish})`)
      ctx.fillStyle = g
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    // The open frame — luminance-borne, present at every varnish.
    ctx.strokeStyle = hsl(38, 0.85 * P.varnish, 0.60)
    ctx.lineWidth = Math.max(1, this.S(0.0012))
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  }

  /** Draws the pulse set by rewardPulse(). Additive, edge-weighted, gated. */
  rewardWash (ctx, P, w, h, dt, effects = EFFECTS_PROFILE.full) {
    this.pulse = Math.max(0, this.pulse - dt / 0.45)
    if (this.pulse < 0.01 || P.varnish <= 0.01 || effects.rewardWash <= 0) return
    const k = this.pulse * this.pulse * effects.rewardWash // ease out — a bloom, not a blink
    const cx = w / 2, cy = h / 2
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // Edge-weighted: the centre, where the balls are, stays readable.
    const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.26, cx, cy, Math.max(w, h) * 0.78)
    g.addColorStop(0, 'hsla(0 0% 0% / 0)')
    g.addColorStop(0.55, hsl(44, P.saturation * 1.2, 0.5, 0.10 * k * P.varnish))
    g.addColorStop(1, hsl(38, P.saturation * 1.3, 0.5, 0.30 * k * P.varnish))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  background (ctx, P, w, h, dop) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, P.bgDeep)
    g.addColorStop(1, P.bg)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  /**
   * The machine's eye.
   *
   * A dark iris behind the nail field whose pupil dilates with arousal. Pupil
   * diameter is a real autonomic correlate of arousal, which is why this is the
   * one surreal flourish that earns its place: the machine's interior state is
   * on the outside, reported by the same organ that would report yours.
   */
  iris (ctx, P, dop) {
    const cx = this.X(BOARD.rail.cx), cy = this.Y(BOARD.rail.cy)
    const R = this.S(BOARD.rail.r * 0.95)
    const g = ctx.createRadialGradient(cx, cy, R * 0.10, cx, cy, R)
    g.addColorStop(0, P.iris)
    g.addColorStop(1, P.bgDeep)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill()

    // Iris fibres, in the annulus between the housing and the rail — the only
    // part of the eye the display does not cover. They brighten with arousal.
    const fib = 72
    ctx.save()
    ctx.globalAlpha = (0.05 + 0.16 * dop.arousal) * P.varnish
    ctx.strokeStyle = P.boardEdge
    ctx.lineWidth = 1
    for (let i = 0; i < fib; i++) {
      const a = (i / fib) * TAU
      const jitter = 0.82 + 0.14 * Math.sin(i * 12.9898)
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * R * 0.52, cy + Math.sin(a) * R * 0.52)
      ctx.lineTo(cx + Math.cos(a) * R * jitter, cy + Math.sin(a) * R * jitter)
      ctx.stroke()
    }
    ctx.restore()

    // The pupil must be large enough to escape the housing, or the machine's one
    // honest tell is hidden behind its own advertising. At rest it peeks out
    // below the display; roused, it spreads through the nail field.
    const pupil = R * (0.40 + 0.38 * dop.arousal * P.varnish)
    const pg = ctx.createRadialGradient(cx, cy, pupil * 0.35, cx, cy, pupil)
    pg.addColorStop(0, P.pupil)
    pg.addColorStop(0.70, P.pupil)
    pg.addColorStop(1, 'transparent')
    ctx.fillStyle = pg
    ctx.beginPath(); ctx.arc(cx, cy, pupil, 0, TAU); ctx.fill()
  }

  boardFace (ctx, P) {
    ctx.strokeStyle = P.boardEdge
    ctx.lineWidth = 1
    ctx.strokeRect(this.X(0), this.Y(0), this.S(BOARD.w), this.S(BOARD.h))
  }

  rail (ctx, P, m) {
    ctx.lineCap = 'round'
    for (const s of m.world.segments) {
      if (s.disabled) continue
      const id = s.id || ''
      if (id.startsWith('tulip') || id.startsWith('heso') || id === 'attacker-flap') continue
      ctx.strokeStyle = id === 'return-rubber' ? hsl(P.hue - 150, P.saturation * 0.6, 0.42) : P.rail
      if (id === 'housing') continue
      ctx.lineWidth = Math.max(1, this.S(s.r * 2))
      ctx.beginPath()
      ctx.moveTo(this.X(s.ax), this.Y(s.ay))
      ctx.lineTo(this.X(s.bx), this.Y(s.by))
      ctx.stroke()
    }
  }

  /**
   * The motif's background artwork — the 1970s move: a printed picture behind
   * the nails, with the brass laid out to MATCH it (operator's design, from a
   * Nishijin Deluxe Super reference).
   *
   * THE LACQUER RULING, explicit: the artwork is PURE LACQUER. The contour's
   * information — why the nails sit where they sit — is carried by the nails
   * themselves, which render at every varnish; the picture is celebration, so
   * it is gated at varnish > 0.01 and its alpha rides the varnish, exactly the
   * tanuki-mascot idiom. Art lives HERE, keyed by motif id — the sim-side
   * motif carries geometry only (L4: the Machine never sees an image).
   *
   * Composited between the iris and the board face: under nails, walls, and
   * every instrument, over the machine's eye.
   */
  motifBackdrop (ctx, P, m) {
    const motif = m.parts.motif
    if (!motif || P.varnish <= 0.01) return
    const art = MOTIF_ART[motif.id]
    if (!art) return
    if (art.draw) {
      ctx.save()
      ctx.globalAlpha = (art.alpha ?? 1) * P.varnish
      art.draw(ctx, { R: this, P, motif, time: this._t })
      ctx.restore()
      return
    }
    if (!art.img) {
      if (typeof Image === 'undefined') return
      art.img = new Image()
      art.img.src = art.src
    }
    if (!art.img.complete || !art.img.naturalWidth) return
    ctx.save()
    ctx.globalAlpha = art.alpha * P.varnish
    ctx.drawImage(art.img, this.X(art.x), this.Y(art.y), this.S(art.w), this.S(art.h))
    ctx.restore()
  }

  housing (ctx, P, m) {
    const H = m.parts.housing
    if (!H) return                       // a motif board may have no centre housing
    ctx.fillStyle = P.housing
    ctx.beginPath()
    ctx.moveTo(this.X(H.x0), this.Y(H.y0))
    for (let x = H.x0; x <= H.x1; x += 0.004) ctx.lineTo(this.X(x), this.Y(H.dome(x)))
    ctx.lineTo(this.X(H.x1), this.Y(H.y1 - H.rr))
    ctx.arcTo(this.X(H.x1), this.Y(H.y1), this.X(H.x1 - H.rr), this.Y(H.y1), this.S(H.rr))
    ctx.lineTo(this.X(H.x0 + H.rr), this.Y(H.y1))
    ctx.arcTo(this.X(H.x0), this.Y(H.y1), this.X(H.x0), this.Y(H.y1 - H.rr), this.S(H.rr))
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = P.boardEdge
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  /**
   * The digital display — 図柄表示装置, the liquid crystal.
   *
   * This is the most important object on the board and the reason the game
   * exists. The ball landing in the start pocket did not win anything; it bought
   * a ticket, and the verdict on that ticket was reached instantly and silently.
   * What happens here afterwards is a *readout*, staged over four seconds,
   * dressed as a contest.
   *
   * Reels stop left, then right, then middle — which is the entire near-miss
   * engine, because it means the machine can show you two matching symbols and
   * then take its time. Clark et al. (2009) found that arrangement recruits the
   * same ventral striatal response as an actual win.
   *
   * The pending queue (保留) is drawn beneath: four lamps, legally capped at
   * four, each a ball that already paid and is waiting its turn to lose.
   */
  display (ctx, P, m, dop) {
    // The screen rectangle has exactly one provider: the board's own
    // parts.displayRect when a motif relocated the readout to the margins,
    // else the rect derived from the housing with today's exact numbers.
    // Everything inside — reels, verdicts, pending lamps, the tanuki video —
    // is rect-relative, so this one seam moves the whole readout.
    const H = m.parts.housing
    const D = m.parts.displayRect ||
      (H && { x0: H.x0 + 0.016, y0: H.y0 - 0.008, x1: H.x1 - 0.016, y1: H.y1 - 0.030 })
    if (!D) return
    const x0 = this.X(D.x0), x1 = this.X(D.x1)
    const y0 = this.Y(D.y0), y1 = this.Y(D.y1)
    const w = x1 - x0, h = y1 - y0

    // ── the flapper's screen ─────────────────────────────────────────────
    // The hane spec has no lottery, so its LCD is not a stage — it is a
    // MECHANICAL READOUT: what the wings are doing right now, and the count
    // of times the navel has worked them. No reels, no verdicts, no seed.
    if (m.S.flapper) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `500 ${Math.max(7, h * 0.085)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(P.hue, P.saturation * 0.35, 0.40)
      ctx.fillText('羽根物 NO LOTTERY', x0 + w / 2, y0 + h * 0.13)
      const open = (m.parts.tulips || []).some(t => t.open)
      ctx.font = `600 ${Math.max(12, h * 0.30)}px ui-monospace, monospace`
      ctx.fillStyle = open
        ? hsl(44, P.saturation * 1.1, 0.62)
        : hsl(P.hue, P.saturation * 0.30, 0.34)
      ctx.fillText(open ? '羽 OPEN' : 'CLOSED', x0 + w / 2, y0 + h * 0.46)
      ctx.font = `500 ${Math.max(7, h * 0.10)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(P.hue, P.saturation * 0.35, 0.45)
      ctx.fillText(`翼 ${m.flaps} openings`, x0 + w / 2, y0 + h * 0.78)
      return
    }

    ctx.fillStyle = hsl(P.hue + 4, P.saturation * 0.35, 0.055 + 0.03 * dop.arousal)
    ctx.fillRect(x0, y0, w, h)
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.25, 0.24)
    ctx.lineWidth = 1
    ctx.strokeRect(x0, y0, w, h)

    const sym = m.spinSymbols()
    const cellW = w / 3
    const cy = y0 + h * 0.46
    const fs = Math.max(12, h * 0.34)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // What this screen IS, printed on it: a lottery, at these odds. The ball
    // in the start pocket bought the ticket; this is the readout. Nobody
    // should have to guess that — a player did, and said so.
    ctx.font = `500 ${Math.max(7, h * 0.085)}px ui-monospace, monospace`
    ctx.fillStyle = m.kakuhen > 0
      ? hsl(P.hue - 150, P.saturation * 1.2, 0.55)
      : hsl(P.hue, P.saturation * 0.35, 0.40)
    // The odds BREATHE — oddsNow is the wave's live figure, and the arrow is
    // the tide's direction. A timing skill needs a clock the player can read,
    // so the readout is the truth at this instant, not the book number.
    const rising = m.wavePhase < WAVE.crest
    ctx.fillText(`抽選 LOTTERY 1/${Math.round(m.oddsNow)} ${rising ? '↗' : '↘'}`, x0 + w / 2, y0 + h * 0.13)

    ctx.font = `500 ${fs}px ui-monospace, Menlo, Consolas, monospace`

    // Reel stop schedule, as a fraction of the spin. The middle reel is last and
    // slowest — that lateness IS the near-miss.
    const STOP = [0.34, 0.58]
    for (let i = 0; i < 3; i++) {
      const cx = x0 + cellW * (i + 0.5)
      let glyph, bright
      if (!m.spin) {
        glyph = m.lastSymbols ? m.lastSymbols[i] : '·'
        // The matched triple stays LIT through the jackpot it won — the one
        // moment the machine has something true to brag about.
        bright = m.inJackpot ? 0.78 : 0.20
      } else {
        const k = m.spin.t / m.spin.dur
        const order = i === 0 ? 0 : i === 2 ? 1 : 2
        const stopped = order < 2 ? k > STOP[order] : k > 0.96
        if (stopped) {
          glyph = sym[i]
          bright = 0.78
        } else {
          // Spinning: cycle fast, and for the middle reel on a reach, crawl.
          const speed = (order === 2 && m.spin.reach && k > STOP[1]) ? 5 : 34
          glyph = Math.floor((m.spin.t * speed + i * 3)) % 8
          bright = order === 2 && m.spin.reach && k > STOP[1] ? 0.9 : 0.5
        }
      }
      const reaching = m.spin && m.spin.reach && m.spin.t / m.spin.dur > STOP[1]
      ctx.fillStyle = reaching && i !== 1
        ? hsl(44, 0.85 * P.saturation * 2, 0.62)
        : hsl(P.hue - 4, P.saturation * 0.5, bright)
      ctx.fillText(String(glyph), cx, cy)
    }

    // The verdict, stated. A losing spin used to simply stop — a player
    // watching the reels could not tell a resolution from a stall.
    const res = m.lastResolve
    const resFresh = !m.spin && res && m.time - res.at < 1.4
    if (m.inJackpot && m.jackpot.fanfare > 0) {
      // The opening sequence: the ceiling, and a bar closing on the moment the
      // mouth opens. Both numbers are real — the ceiling is rounds × entries ×
      // pay, and the bar is the actual countdown the simulation is running.
      const j = m.jackpot
      const k = 1 - j.fanfare / 2.6
      ctx.font = `600 ${Math.max(9, h * 0.13)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(44, P.saturation * 1.5, 0.52 + 0.20 * Math.sin(this._t * 15))
      ctx.fillText(`最大 ${m.S.rounds * m.S.entriesPerRound * m.S.payPerEntry}`, x0 + w / 2, y0 + h * 0.79)
      const bw = w * 0.52, bx = x0 + w / 2 - bw / 2, by = y0 + h * 0.90
      ctx.fillStyle = hsl(P.hue, P.saturation * 0.3, 0.20)
      ctx.fillRect(bx, by, bw, Math.max(2, h * 0.022))
      ctx.fillStyle = hsl(44, P.saturation * 1.4, 0.60)
      ctx.fillRect(bx, by, bw * k, Math.max(2, h * 0.022))
    } else if (m.inJackpot) {
      // The running count, in the room's own currency, while the attacker
      // swallows. This is the number the player is actually earning, live.
      const j = m.jackpot
      ctx.font = `600 ${Math.max(9, h * 0.13)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(44, P.saturation * 1.5, 0.60)
      ctx.fillText(`R${j.round}/${m.S.rounds}  +${j.paid}`, x0 + w / 2, y0 + h * 0.83)
    } else if (resFresh && res.kind === 'ko') {
      ctx.font = `600 ${Math.max(9, h * 0.12)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(44, P.saturation * 1.4, 0.60)
      ctx.fillText('小当たり  SMALL WIN', x0 + w / 2, y0 + h * 0.83)
    } else if (resFresh && res.kind === 'lose' && res.seq) {
      // 順目 — a straight. The run pays it in score; the display names it in
      // the mid register: brighter than a miss, dimmer than a win.
      ctx.font = `600 ${Math.max(9, h * 0.11)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(P.hue - 150, P.saturation * 1.1, 0.55)
      ctx.fillText(`順目  STRAIGHT${res.paid ? `  +${res.paid}` : ''}`, x0 + w / 2, y0 + h * 0.83)
    } else if (resFresh && res.kind === 'lose') {
      ctx.font = `500 ${Math.max(8, h * 0.10)}px ui-monospace, monospace`
      ctx.fillStyle = res.paid
        ? hsl(44, P.saturation * 0.8, 0.50)
        : hsl(P.hue, P.saturation * 0.3, 0.38)
      // The consolation states its size; a bare miss stays a bare miss.
      ctx.fillText(res.paid ? `ハズレ  MISS · +${res.paid}` : 'ハズレ  MISS', x0 + w / 2, y0 + h * 0.83)
    } else if (m.spin && m.spin.reach && m.spin.t / m.spin.dur > STOP[1]) {
      ctx.font = `500 ${Math.max(8, h * 0.11)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(44, P.saturation * 1.4, 0.55)
      ctx.fillText('リーチ  REACH', x0 + w / 2, y0 + h * 0.83)
    } else if (m.kakuhen > 0) {
      ctx.font = `500 ${Math.max(8, h * 0.10)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(P.hue - 150, P.saturation * 1.2, 0.55)
      ctx.fillText(`確変 ${m.kakuhen}`, x0 + w / 2, y0 + h * 0.83)
    }

    // The character, celebrating on the LCD — during a jackpot only, exactly
    // as a licensed machine would. A slow bob, no strobe. Pure lacquer: at
    // varnish 0 the screen keeps the numbers and loses the mascot, which is
    // the honest split — the count is information, the character is the con.
    if (m.inJackpot && P.varnish > 0.01) {
      // The video plays only while the party is on; otherwise it sits
      // rewound, so every jackpot's animation starts from its first frame.
      const v = this.tanukiVid
      if (v && v.paused) v.play().catch(() => {})
      const bob = Math.sin(this._t * 5.5) * h * 0.018
      if (v && v.readyState >= 2 && v.videoWidth) {
        const th = h * 0.52
        const tw = th * v.videoWidth / v.videoHeight
        ctx.save()
        ctx.globalAlpha = 0.92 * P.varnish
        ctx.drawImage(v, x1 - tw - w * 0.02, y0 + h * 0.30 + bob, tw, th)
        ctx.restore()
      } else if (this.tanuki && this.tanuki.complete && this.tanuki.naturalWidth) {
        const tw = h * 0.46
        ctx.save()
        ctx.globalAlpha = 0.92 * P.varnish
        ctx.drawImage(this.tanuki, x1 - tw - w * 0.02, y0 + h * 0.34 + bob, tw, tw)
        ctx.restore()
      }
    } else if (this.tanukiVid && !this.tanukiVid.paused) {
      this.tanukiVid.pause()
      this.tanukiVid.currentTime = 0
    }

    // 保留 — the pending queue.
    const ly = y1 + this.S(0.009)
    const lr = Math.max(2, this.S(0.0035))
    for (let i = 0; i < 4; i++) {
      const lx = x0 + w / 2 + (i - 1.5) * this.S(0.013)
      ctx.beginPath()
      ctx.arc(lx, ly, lr, 0, TAU)
      ctx.fillStyle = i < m.holds ? hsl(44, P.saturation * 1.2, 0.60) : hsl(P.hue, P.saturation * 0.2, 0.18)
      ctx.fill()
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  windmills (ctx, P, m) {
    for (const ro of m.rotorsForRender || m.parts.rotors) {
      const cx = this.X(ro.x), cy = this.Y(ro.y), r = this.S(ro.r)
      ctx.strokeStyle = P.nail
      ctx.lineWidth = Math.max(1.4, this.S(0.0022) * 2)
      ctx.lineCap = 'round'
      for (let k = 0; k < ro.blades; k++) {
        const th = ro.ang + (k * TAU) / ro.blades
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r)
        ctx.stroke()
      }
      ctx.fillStyle = P.boardEdge
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, r * 0.16), 0, TAU); ctx.fill()
    }
  }

  /**
   * The nail field, with the sag.
   *
   * During a long dry spell the nails visibly droop and the brass goes dull.
   * This is a rendering offset only — `world.nails` never moves, so the physics
   * and the payout are untouched. It is the board looking tired, not the board
   * cheating.
   */
  nails (ctx, P, m, dop) {
    const sag = dop.extinction * this.S(0.0022) * P.varnish
    const r = Math.max(0.9, this.S(0.0009) * 1.9)
    ctx.fillStyle = P.nail
    for (const n of m.world.nails) {
      ctx.beginPath()
      ctx.arc(this.X(n.x + n.bx), this.Y(n.y + n.by) + sag, r, 0, TAU)
      ctx.fill()
    }
    // The life nails get a mark: they are the two that decide the machine.
    ctx.strokeStyle = hsl(P.hue - 140, P.saturation * 0.5, 0.55, 0.5)
    ctx.lineWidth = 1
    for (const n of m.parts.lifeNails || []) {
      ctx.beginPath()
      ctx.arc(this.X(n.x), this.Y(n.y) + sag, r * 2.4, 0, TAU)
      ctx.stroke()
    }
  }

  /**
   * A nail struck hard enough to ring. Speed-gated by the caller so a graze
   * stays silent; capped so a storm sheds its oldest rings rather than
   * growing.
   */
  nailRipple (x, y, speed, value) {
    if (this.ripples.length >= 48) this.ripples.shift()
    this.ripples.push({
      x, y,
      s: Math.max(0, Math.min(1, (speed - 0.3) / 1.2)),
      v: value, t: 0
    })
  }

  /**
   * The ripples: the trails' vocabulary, applied to the nail field.
   *
   * Each ring's HUE is V(s) — what the machine currently believes a ball at
   * the struck spot is worth, on the same cold-slate-to-gold axis the trails
   * speak (`rippleColour`, which is that axis with a ring-legible floor). So
   * the rain of strikes paints the machine's map one ring at a time: blue out
   * where nothing has been learned, warming to gold over the funnel it values.
   * Nobody chooses the colours.
   *
   * The ALPHA is the strike's energy, fading on the ring's own clock. It is
   * deliberately NOT the model's confidence — that duty belongs to the trails,
   * and a ring's job is to mark that a strike happened, which is true at every
   * confidence.
   *
   * Pure lacquer. The trail already carries the value information; the ring
   * is celebration, so at varnish 0 there are no rings at all.
   */
  rippleLayer (ctx, P, dt) {
    if (P.varnish <= 0.01) { this.ripples.length = 0; return }
    const LIFE = 0.38
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.t += dt
      if (r.t > LIFE) { this.ripples.splice(i, 1); continue }
      const k = r.t / LIFE
      const R = this.S(0.0035 + (0.0055 + 0.0075 * r.s) * k)
      const a = (1 - k) * (1 - k) * (0.30 + 0.45 * r.s) * P.varnish
      if (a < 0.02) continue
      ctx.strokeStyle = rippleColour(r.v, P.varnish, a)
      ctx.lineWidth = Math.max(1, this.S(0.0018) * (1.5 - k))
      ctx.beginPath()
      ctx.arc(this.X(r.x), this.Y(r.y), R, 0, TAU)
      ctx.stroke()
    }
  }

  tulips (ctx, P, m) {
    for (const t of m.parts.tulips) {
      // The cup first, so the wings read as sitting on its lip.
      ctx.fillStyle = hsl(P.hue, P.saturation * 0.30, 0.10)
      ctx.fillRect(this.X(t.x - t.halfMouth), this.Y(t.y), this.S(t.halfMouth * 2), this.S(0.016))
      ctx.strokeStyle = hsl(P.hue, P.saturation * 0.30, 0.30)
      ctx.lineWidth = 1
      ctx.strokeRect(this.X(t.x - t.halfMouth), this.Y(t.y), this.S(t.halfMouth * 2), this.S(0.016))

      // Petals: tapered, so an open tulip reads as a flower rather than a pair
      // of aerials.
      ctx.lineCap = 'round'
      for (const s of [t.segL, t.segR]) {
        const grad = ctx.createLinearGradient(this.X(s.ax), this.Y(s.ay), this.X(s.bx), this.Y(s.by))
        const c = t.open ? P.inkHot : P.rail
        grad.addColorStop(0, c)
        grad.addColorStop(1, hsl(P.hue, P.saturation * 0.2, 0.22))
        ctx.strokeStyle = grad
        ctx.lineWidth = Math.max(2, this.S(0.0028) * 2)
        ctx.beginPath()
        ctx.moveTo(this.X(s.ax), this.Y(s.ay))
        ctx.lineTo(this.X(s.bx), this.Y(s.by))
        ctx.stroke()
      }
      if (t.t > 0.05) {
        ctx.globalAlpha = t.t
        ctx.strokeStyle = P.inkHot
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(this.X(t.x), this.Y(t.y), this.S(0.010) * (1 + t.t), 0, TAU)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }

  attacker (ctx, P, m) {
    const a = m.parts.attacker
    const cx = this.X(BOARD.rail.cx), cy = this.Y(BOARD.rail.cy)
    const R = this.S(BOARD.rail.r)
    ctx.strokeStyle = a.t > 0.5 ? P.inkHot : P.rail
    ctx.lineWidth = Math.max(2, this.S(0.004))
    ctx.beginPath()
    ctx.arc(cx, cy, R, a.a0 * Math.PI / 180, a.a1 * Math.PI / 180)
    ctx.stroke()
    if (a.t > 0.02) {
      ctx.globalAlpha = a.t
      ctx.strokeStyle = P.inkHot
      ctx.lineWidth = Math.max(3, this.S(0.007))
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  pockets (ctx, P, m, dop) {
    // The heso, and the value the machine has learned for the lane above it.
    const h = m.parts.heso
    ctx.fillStyle = hsl(40, P.saturation * 0.8, 0.30 + 0.22 * dop.arousal)
    ctx.fillRect(this.X(h.x - h.hw), this.Y(h.y), this.S(h.hw * 2), this.S(h.depth))
    ctx.strokeStyle = P.inkHot
    ctx.lineWidth = 1.2
    ctx.strokeRect(this.X(h.x - h.hw), this.Y(h.y), this.S(h.hw * 2), this.S(h.depth))

    // Warp mouths.
    for (const k of ['warpL', 'warpR']) {
      const s = m.parts.sensors[k]
      if (!s) continue                   // a motif board may carry fewer warps
      ctx.strokeStyle = hsl(P.hue - 60, P.saturation * 0.5, 0.5, 0.7)
      ctx.strokeRect(this.X(s.x - s.w / 2), this.Y(s.y - s.h / 2), this.S(s.w), this.S(s.h))
    }
  }

  /**
   * The scoring buckets.
   *
   * Drawn as lit cups rather than as holes, because that is what they are for:
   * on a board whose entire thesis is that the start pocket does not pay you,
   * these are the mouths that do, and the eye should be able to tell the two
   * apart across the room. The heso is brass and small; a bucket is a rimmed
   * cup with a light in it.
   *
   * `flare` is a per-site decay set by the shell when the site scores. It is
   * the only per-bucket state the renderer keeps, and it is pure lacquer: at
   * varnish 0 the rim stays drawn and the fill goes grey, so you can still see
   * where the mouths are and how wide the run has made them. The information
   * survives; the celebration does not.
   */
  buckets (ctx, P, m) {
    for (const b of m.parts.buckets || []) {
      const f = (this.bucketFlare.get(b.site) || 0)
      const x = this.X(b.x - b.hw), y = this.Y(b.y)
      const w = this.S(b.hw * 2), h = this.S(b.depth)
      const t = this.bucketTier.get(b.site) || 0

      // The throat, lit from below.
      const g = ctx.createLinearGradient(0, y, 0, y + h)
      g.addColorStop(0, hsl(P.hue, P.saturation * 0.3, 0.10, 0.9))
      g.addColorStop(1, scoreColour(0, P.varnish, 0.45 + 0.5 * f, t))
      ctx.fillStyle = g
      ctx.fillRect(x, y, w, h)

      // The rim: two posts and a floor, matching the real segments.
      ctx.strokeStyle = scoreColour(0, P.varnish, 0.75 + 0.25 * f, t)
      ctx.lineWidth = 1.4 + 2.2 * f
      ctx.beginPath()
      ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y)
      ctx.stroke()

      // The flare itself — a bloom over the mouth, additive so it reads as
      // light rather than as paint.
      if (f > 0.01 && P.varnish > 0.01) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const cx = x + w / 2, cy = y + h * 0.4
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * (1.1 + 1.9 * f))
        rg.addColorStop(0, scoreColour(0, P.varnish, 0.55 * f, t))
        rg.addColorStop(1, 'hsla(0 0% 0% / 0)')
        ctx.fillStyle = rg
        ctx.fillRect(cx - w * 3, cy - w * 3, w * 6, w * 6)
        ctx.restore()
      }
    }
  }

  /**
   * The chain, drawn where the balls are.
   *
   * A combo meter belongs on the board and not in the side panel: it is the one
   * number that changes several times a second, and the eye that is watching a
   * ball fall cannot also be reading a panel. It is sized and coloured by how
   * deep the chain has got — the operator's "bright lights and colours related
   * to score points", applied to the number that most rewards being watched.
   *
   * It lives in the TOP-LEFT corner, under the quota bar. The first placement
   * was centred under the housing, which is a reasonable-looking spot on an
   * empty board and turned out to sit directly on top of the heso and its life
   * nails — the two most important objects in the game, obscured by a readout
   * about how well you were doing at reaching them. The corner is dead space:
   * no nail, no pocket, no ball path.
   */
  chainMeter (ctx, P, run) {
    if (!run || run.chain < 2) return
    const t = Math.min(1, run.chain / 26)
    const x = this.X(0.020)
    const y = this.Y(0.040)
    const grow = 1 + Math.min(1.1, run.chain / 18)
    ctx.save()
    ctx.textAlign = 'left'
    ctx.font = `700 ${(13 * grow).toFixed(1)}px ui-monospace, monospace`
    if (P.varnish > 0.01) {
      ctx.shadowColor = scoreColour(0, P.varnish, 0.7, t)
      ctx.shadowBlur = 4 + 18 * t
    }
    ctx.fillStyle = scoreColour(0, P.varnish, 0.95, t)
    ctx.fillText(`×${run.mult.toFixed(1)}`, x, y)
    ctx.shadowBlur = 0
    ctx.font = '500 8px ui-monospace, monospace'
    ctx.fillStyle = P.inkDim
    ctx.fillText(`CHAIN ${run.chain}`, x, y + 11)
    // The window closing. A bar that empties is the honest rendering of a
    // timer, and it is the one piece of pressure in the game that the player
    // can actually do something about in the next half-second.
    const frac = run.chainLeft / run.loadout.comboWindow
    const bw = this.S(0.052)
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.2, 0.28)
    ctx.fillRect(x, y + 15, bw, 2)
    ctx.fillStyle = scoreColour(0, P.varnish, 0.9, t)
    ctx.fillRect(x, y + 15, bw * frac, 2)
    ctx.restore()
  }

  /**
   * The quota bar: the wall, drawn across the top of the board.
   *
   * Deliberately a bar and not a number. The player needs to know one thing at
   * a glance — am I going to make it — and a fraction answers that faster than
   * two six-digit figures do. The numbers are in the panel for anyone who wants
   * them.
   */
  quotaBar (ctx, P, run) {
    // No wall in the sandbox — a full bar over a quota of zero would be the
    // renderer asserting a fact the run does not hold.
    if (!run || run.sandbox) return
    const x0 = this.X(0.014), x1 = this.X(BOARD.w - 0.014)
    const y = this.Y(0.006)
    const p = run.progress
    const t = scoreTier(run.quota / denomFor(run.floor || 1) / 10)
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.2, 0.20)
    ctx.fillRect(x0, y, x1 - x0, 3)
    ctx.fillStyle = p >= 1 ? scoreColour(0, P.varnish, 1, 1) : scoreColour(0, P.varnish, 0.95, t)
    ctx.fillRect(x0, y, (x1 - x0) * p, 3)
    // A tick where the quota sits is redundant (the bar IS the quota) but the
    // OVERSHOOT is not: past 100% the bar stays full and the surplus is what
    // the run is actually scored on, so it gets its own thin overlay.
    if (p >= 1) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = scoreColour(0, P.varnish, 0.5, 1)
      ctx.fillRect(x0, y - 1, x1 - x0, 5)
      ctx.restore()
    }
  }

  /**
   * A score, thrown up where it was earned.
   *
   * Separate from `pop()` — which floats the machine's PAYOUT in balls and is
   * ledger truth — because these are two different claims and conflating them
   * would undo the one piece of honesty the popups were built for. A payout is
   * what the machine gave you. A score is what the run decided that was worth.
   * They appear together at the same pocket and they are allowed to disagree.
   */
  scorePop (x, y, n, chain = 1, denom = 1) {
    // The floor's denomination inflates every printed number (see run.js);
    // the TIER divides it back out, so the colour ramp keeps speaking
    // relative value — a deep floor prints billions but a heso is still a
    // heso-coloured heso. Display keeps the big number; colour keeps the truth.
    this.scorePops.push({ x, y, n, chain, t: 0, tier: scoreTier(n / (denom || 1)) })
  }

  scorePopLayer (ctx, P, dt) {
    for (let i = this.scorePops.length - 1; i >= 0; i--) {
      const s = this.scorePops[i]
      s.t += dt
      const LIFE = 1.15
      if (s.t > LIFE) { this.scorePops.splice(i, 1); continue }
      const k = s.t / LIFE
      const rise = P.varnish > 0.01 ? 34 * (1 - Math.pow(1 - k, 2.4)) : 18 * k
      // Pop-in overshoot, then settle. Scaled by tier so a big number arrives
      // physically bigger, not merely a different colour.
      const pop = s.t < 0.09 ? 0.55 + 4.9 * s.t : 1
      const size = (10 + 15 * s.tier) * (P.varnish > 0.01 ? pop : 1)
      const a = Math.max(0, 1 - Math.pow(k, 2.6))
      ctx.save()
      ctx.textAlign = 'center'
      ctx.font = `700 ${size.toFixed(1)}px ui-monospace, monospace`
      if (P.varnish > 0.01) {
        ctx.shadowColor = scoreColour(s.n, P.varnish, 0.85 * a, s.tier)
        ctx.shadowBlur = 6 + 26 * s.tier
      }
      ctx.fillStyle = P.varnish > 0.01
        ? scoreColour(s.n, P.varnish, a, s.tier)
        : `hsla(0 0% 86% / ${a})`
      ctx.fillText(fmtScore(s.n), this.X(s.x), this.Y(s.y) - rise)
      ctx.restore()
    }
  }

  /**
   * ROUTE MODE — the recorded stories, rendered.
   *
   * An INSTRUMENT, not lacquer: it draws at every varnish (valueColour
   * collapses to luminance at 0, so the data survives the switch the way all
   * information here does), and it exists for testing — the operator's
   * design: the full route is always in the data, and this is the mode that
   * lets you see it. Completed routes render faint, live ones brighter, and
   * every route ends in a dot where the ball died. Colour is chunked rather
   * than per-segment: sixty full routes at per-segment colour is ~70k
   * strokes a frame, and an instrument that halves the frame rate changes
   * what it is measuring.
   *
   * A warped ball's story arrives in two routes — the warp consumes one ball
   * id and spawns another. The gap between them IS the warp.
   */
  routeLayer (ctx, P) {
    if (!this.testMode) return
    ctx.save()
    ctx.lineCap = 'round'
    const route = (pts, alpha, width) => {
      if (pts.length < 2) return
      for (let s = 0; s < pts.length - 1; s += ROUTE_CHUNK) {
        const end = Math.min(pts.length - 1, s + ROUTE_CHUNK)
        const mid = pts[(s + end) >> 1]
        ctx.strokeStyle = valueColour(mid.v, P.varnish, alpha * (0.35 + 0.65 * mid.c))
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(this.X(pts[s].x), this.Y(pts[s].y))
        for (let i = s + 1; i <= end; i++) ctx.lineTo(this.X(pts[i].x), this.Y(pts[i].y))
        ctx.stroke()
      }
      const last = pts[pts.length - 1]
      ctx.fillStyle = valueColour(last.v, P.varnish, alpha)
      ctx.beginPath()
      ctx.arc(this.X(last.x), this.Y(last.y), Math.max(1.5, this.S(0.0022)), 0, TAU)
      ctx.fill()
    }
    const from = Math.max(0, this.routeLog.length - ROUTE_DRAW_MAX)
    for (let i = from; i < this.routeLog.length; i++) {
      route(this.routeLog[i], 0.22, Math.max(0.6, this.S(0.0012)))
    }
    for (const tr of this.trails.values()) route(tr, 0.55, Math.max(1, this.S(0.002)))
    ctx.restore()
  }

  trailsAndBalls (ctx, P, m, dop, dt) {
    const live = new Set()
    for (const b of m.world.balls) {
      live.add(b.id)
      let tr = this.trails.get(b.id)
      if (!tr) this.trails.set(b.id, tr = [])
      // The FULL route accumulates — recording is always on, rendering is
      // not. The visible tail below is a windowed view of the same array.
      if (tr.length < ROUTE_MAX_POINTS) {
        tr.push({ x: b.x, y: b.y, v: dop.valueAt(b.x, b.y), c: dop.confidenceAt(b.x, b.y) })
      }
    }
    for (const id of [...this.trails.keys()]) {
      if (!live.has(id)) {
        // The ball is gone: its complete story goes to the log, and only its
        // visible tail stays behind to fade out.
        const tr = this.trails.get(id)
        this.trails.delete(id)
        this.routeLog.push(tr)
        if (this.routeLog.length > ROUTE_LOG_MAX) this.routeLog.shift()
        this.fades.push(tr.slice(-TRAIL_MAX))
      }
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i]
      f.shift(); f.shift()
      if (f.length < 2) this.fades.splice(i, 1)
    }

    ctx.lineCap = 'round'
    // The tail: the last TRAIL_MAX points of a live route, plus the fades —
    // drawn exactly as trails always were, so recording the whole story
    // changed nothing the player sees.
    const tail = (pts) => {
      const start = Math.max(1, pts.length - TRAIL_MAX + 1)
      const span = Math.min(pts.length, TRAIL_MAX)
      for (let i = start; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        const k = (i - start + 1) / span
        ctx.strokeStyle = trailColour(b.v, b.c * k, P.varnish)
        ctx.lineWidth = Math.max(0.6, this.S(0.0055) * 1.5 * k)
        ctx.beginPath()
        ctx.moveTo(this.X(a.x), this.Y(a.y))
        ctx.lineTo(this.X(b.x), this.Y(b.y))
        ctx.stroke()
      }
    }
    for (const tr of this.trails.values()) tail(tr)
    for (const f of this.fades) tail(f)

    const r = this.S(0.0055)
    for (const b of m.world.balls) {
      const x = this.X(b.x), y = this.Y(b.y)
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
      if (b.gold) {
        // A gold ball IS information — it will split at its first nail — but
        // information survives varnish 0 as LUMINANCE in this codebase (the
        // payout numbers go grey ink, the chrome ball is documented as
        // luminance-borne), never as smuggled hue. The first draft kept 55%
        // saturation at varnish 0 and put one gold ball on the grey
        // engineering drawing (review finding); now the hue is lacquer and
        // the stops' darker profile — 92/60/30 against silver's white/72/28 —
        // is what says "this one is different" when the colour is gone.
        const s = 0.95 * P.varnish
        g.addColorStop(0, hsl(48, s, 0.92))
        g.addColorStop(0.55, hsl(44, s, 0.60))
        g.addColorStop(1, hsl(38, s, 0.30))
      } else {
        g.addColorStop(0, '#fff')
        g.addColorStop(0.55, P.ball)
        g.addColorStop(1, `hsla(0 0% 28% / 1)`)
      }
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
      // TEMPER RINGS — one thin halo per tier, the same varnish law as gold:
      // hue is lacquer (warms with tier), but the ring's EXISTENCE and its
      // brightness are luminance-borne, so a tempered ball reads tempered on
      // the grey engineering drawing too. It is information — this ball's
      // pockets score ×3 a ring — and information survives the switch.
      if (b.temper > 0) {
        for (let ti = 1; ti <= b.temper; ti++) {
          const rr = r * (1.25 + ti * 0.28)
          ctx.strokeStyle = hsl(48 - ti * 8, 0.85 * P.varnish, 0.58 + ti * 0.08)
          ctx.lineWidth = Math.max(0.8, this.S(0.0010))
          ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke()
        }
      }
      // A spin tick, so the ball's rotation is visible. It is real state.
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(b.a) * r * 0.7, y + Math.sin(b.a) * r * 0.7)
      ctx.stroke()
    }
  }

  /**
   * The launcher, cut away.
   *
   * A real cabinet hides all of this behind a round handle: you rotate a dial and
   * a hammer you never see strikes a ball you never see. Showing the mechanism is
   * the same move the rest of the game makes — put the machine's interior on the
   * outside — and it makes the one control you actually have legible.
   *
   * Everything drawn here is real state read off the Machine. The hammer sits at
   * `power` — the live pull, which rests at the BASE slider and draws further
   * back while the trigger is held — its strike is `hammer`, the readiness lamp
   * is `readiness`, and the scatter arc is `nextJitter`, the actual standard
   * deviation the next shot will be given. The odds bar is the route split of
   * the shot currently being built, so pulling back visibly swings the odds.
   *
   * The travel scale doubles as the control itself: main.js maps pointer drags
   * on the cabinet strip through `dialFromX`, so the drawing and the input are
   * the same object and cannot disagree.
   */
  launcher (ctx, P, m) {
    const y0 = this.Y(BOARD.h) + this.S(0.008)
    const h = this.S(BOARD.cabinetH - 0.012)
    const x0 = this.X(0.010)
    const w = this.S(BOARD.w - 0.020)
    const mid = y0 + h * 0.44

    // Casing.
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.22, P.brightness * 0.16)
    ctx.fillRect(x0, y0, w, h)
    ctx.strokeStyle = P.boardEdge
    ctx.lineWidth = 1
    ctx.strokeRect(x0, y0, w, h)

    // ── the travel scale ──
    const railL = x0 + w * 0.06
    const railR = x0 + w * 0.62
    const span = railR - railL
    // Published for hit-testing: the scale IS the base-power slider.
    this.dialRail = { x0: railL, x1: railR }
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.2, 0.26)
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(railL, mid + this.S(0.011)); ctx.lineTo(railR, mid + this.S(0.011)); ctx.stroke()
    ctx.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      const x = railL + span * (i / 10)
      const big = i % 5 === 0
      ctx.beginPath()
      ctx.moveTo(x, mid + this.S(0.011))
      ctx.lineTo(x, mid + this.S(big ? 0.019 : 0.015))
      ctx.stroke()
    }

    // The BASE thumb — the resting pull, where every quick tap fires from.
    // Drawn as a HANDLE, not a tick, because it is one: grip lines, a body
    // wide enough to see and to hit, and a pointer up to the scale. (A 3 px
    // triangle read as a readout; nobody dragged it. Review finding.)
    const baseX = railL + span * m.dial
    // Sized as the MAIN KNOB it is (operator's ruling): the thumb is the one
    // continuous control in the game, so it gets a hand-sized handle.
    const thW = Math.max(18, this.S(0.016))
    const thH = Math.max(13, this.S(0.011))
    const thY = mid + this.S(0.0135)
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.5, 0.62)
    ctx.beginPath()
    ctx.moveTo(baseX, mid + this.S(0.010))
    ctx.lineTo(baseX - this.S(0.0032), thY)
    ctx.lineTo(baseX + this.S(0.0032), thY)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.35, 0.30)
    ctx.fillRect(baseX - thW / 2, thY, thW, thH)
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.5, 0.60)
    ctx.lineWidth = 1
    ctx.strokeRect(baseX - thW / 2, thY, thW, thH)
    for (let gi = -1; gi <= 1; gi++) {
      ctx.beginPath()
      ctx.moveTo(baseX + gi * thW * 0.22, thY + thH * 0.25)
      ctx.lineTo(baseX + gi * thW * 0.22, thY + thH * 0.75)
      ctx.stroke()
    }
    ctx.font = `500 ${Math.max(7, this.S(0.0068))}px ui-monospace, monospace`
    ctx.fillStyle = P.inkDim
    ctx.textAlign = 'center'
    ctx.fillText('BASE', baseX, thY + thH + this.S(0.0075))
    ctx.textAlign = 'left'

    // Where the two routes are closest to even odds — measured, not derived.
    // ROUTE_ODDS and the 50:50 tick were measured on the STOCK field, and a
    // review measured a motif field moving the real split 15–20 points — so
    // on motif boards the tick hides and the split bar greys (the jam idiom:
    // outside the measured domain, the instrument says so). Per-motif tables
    // are a future, pre-registered measurement.
    const motifField = !!m.parts.motif
    const tDial = this.thresholdDial()
    if (!motifField && tDial > 0 && tDial < 1) {
      const tx = railL + span * tDial
      ctx.strokeStyle = hsl(44, P.saturation * 1.3, 0.55)
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(tx, mid - this.S(0.016)); ctx.lineTo(tx, mid + this.S(0.019)); ctx.stroke()
      ctx.font = `500 ${Math.max(7, this.S(0.0075))}px ui-monospace, monospace`
      ctx.fillStyle = hsl(44, P.saturation * 1.1, 0.52)
      ctx.textAlign = 'center'
      // Above the scale — the BASE thumb's label owns the space below, and the
      // recommended base sits exactly on this tick.
      ctx.fillText('50:50', tx, mid - this.S(0.021))
      ctx.textAlign = 'left'
    }

    // The live route odds OF THE SHOT BEING BUILT, drawn as a split bar above
    // the rail. Reads `power`, not `dial` — so drawing the hammer back sweeps
    // the odds rightward in real time, which is the whole point of showing them.
    // The split is genuine measured behaviour, not a model.
    const pRight = routeOdds(m.power)
    // During a channel jam the solo table is outside its measured domain:
    // the bar greys and says so rather than asserting through the traffic.
    const jam = m.foulHeat > 1.6
    const obY = y0 + h * 0.20
    const obX = x0 + w * 0.22, obW = w * 0.34, obH = this.S(0.006)
    if (jam || motifField) ctx.globalAlpha = 0.35
    ctx.fillStyle = hsl(212, P.saturation * 0.7, 0.42)
    ctx.fillRect(obX, obY - obH / 2, obW * (1 - pRight), obH)
    ctx.fillStyle = hsl(30, P.saturation * 0.9, 0.50)
    ctx.fillRect(obX + obW * (1 - pRight), obY - obH / 2, obW * pRight, obH)
    ctx.font = `500 ${Math.max(7, this.S(0.0072))}px ui-monospace, monospace`
    ctx.fillStyle = P.inkDim
    ctx.textAlign = 'right'
    ctx.fillText(`左 ${Math.round((1 - pRight) * 100)}`, obX - this.S(0.004), obY + this.S(0.003))
    ctx.textAlign = 'left'
    ctx.fillText(`${Math.round(pRight * 100)} 右${jam ? ' · solo' : motifField ? ' · 未測' : ''}`,
      obX + obW + this.S(0.004), obY + this.S(0.003))
    ctx.globalAlpha = 1

    // ── the hammer ──
    // Sits at the live pull: resting at BASE, drawing back while the trigger is
    // held, holding its draw while a released shot waits out the lockout, and
    // snapping forward on the strike.
    const draw = m.power
    const strike = m.hammer * m.hammer
    const hy = mid
    const hw = this.S(0.011)
    const hh = this.S(0.020)
    const hx = railL + hw + (span - hw * 2) * draw * (1 - strike)
    const anchorX = railR + this.S(0.006)

    // Return spring, between the back of the hammer and its anchor. The zigzag
    // keeps a fixed number of coils over a shrinking span, so drawing the hammer
    // back visibly compresses it.
    const back = hx + hw
    const amp = this.S(0.0062)
    const N = 18
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.28, 0.34 + 0.16 * draw)
    ctx.lineWidth = Math.max(1, this.S(0.0015))
    ctx.beginPath()
    ctx.moveTo(back, hy)
    for (let i = 1; i < N; i++) {
      const sx = back + (anchorX - back) * (i / N)
      ctx.lineTo(sx, hy + (i % 2 ? -amp : amp))
    }
    ctx.lineTo(anchorX, hy)
    ctx.stroke()

    // Anchor block.
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.2, 0.30)
    ctx.fillRect(anchorX, hy - this.S(0.012), this.S(0.005), this.S(0.024))

    // The hammer head.
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.30, 0.44 + 0.34 * strike)
    ctx.fillRect(hx - hw, hy - hh / 2, hw * 2, hh)
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.45, 0.70 + 0.25 * strike)
    ctx.lineWidth = 1
    ctx.strokeRect(hx - hw, hy - hh / 2, hw * 2, hh)

    // Draw-length bracket under the hammer, so the pull-back is measurable and
    // not just felt.
    ctx.strokeStyle = hsl(44, P.saturation * (0.5 + 0.6 * draw), 0.50)
    ctx.lineWidth = Math.max(1, this.S(0.0018))
    ctx.beginPath()
    ctx.moveTo(railL, mid + this.S(0.011))
    ctx.lineTo(hx, mid + this.S(0.011))
    ctx.stroke()

    // The pull past base, made loud: a hot overdraw from the BASE thumb to the
    // hammer, and a live percentage. Charging is the one moment the player is
    // doing something continuous, so it gets continuous feedback.
    const pulled = m.power - m.dial
    if (pulled > 0.005) {
      ctx.strokeStyle = hsl(30, P.saturation * (0.8 + 0.5 * m.power), 0.58)
      ctx.lineWidth = Math.max(2, this.S(0.0030))
      ctx.beginPath()
      ctx.moveTo(baseX, mid + this.S(0.011))
      ctx.lineTo(hx, mid + this.S(0.011))
      ctx.stroke()
      ctx.font = `500 ${Math.max(8, this.S(0.0085))}px ui-monospace, monospace`
      ctx.fillStyle = hsl(30, P.saturation * 1.1, 0.62)
      ctx.textAlign = 'center'
      ctx.fillText(`PULL ${Math.round(m.power * 100)}%`, hx, mid - this.S(0.018))
      ctx.textAlign = 'left'
    }

    // The ball in the cradle, waiting to be struck. Fades in as the mechanism
    // comes back off its lockout.
    const br = this.S(0.0055)
    const ready = m.readiness
    ctx.globalAlpha = 0.20 + 0.80 * ready
    const bx = railL - this.S(0.011)
    const g = ctx.createRadialGradient(bx - br * 0.35, hy - br * 0.4, br * 0.1, bx, hy, br)
    g.addColorStop(0, '#fff'); g.addColorStop(0.55, P.ball); g.addColorStop(1, 'hsla(0 0% 28% / 1)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(bx, hy, br, 0, TAU); ctx.fill()
    ctx.globalAlpha = 1
    // Cradle lip.
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.2, 0.34)
    ctx.lineWidth = Math.max(1, this.S(0.0018))
    ctx.beginPath()
    ctx.moveTo(bx - br * 1.5, hy + br * 1.2)
    ctx.lineTo(bx + br * 1.1, hy + br * 1.2)
    ctx.stroke()

    // ── scatter readout ──
    // A cone whose half-angle is the real standard deviation the next shot gets.
    const sx0 = x0 + w * 0.70
    const sw = w * 0.27
    const jitNorm = Math.min(1, Math.max(0, (m.nextJitter - 0.0035) / (0.026 - 0.0035)))
    const boxT = mid - this.S(0.020)
    const boxH = this.S(0.040)
    ctx.fillStyle = hsl(P.hue, P.saturation * 0.2, 0.09)
    ctx.fillRect(sx0, boxT, sw, boxH)
    ctx.strokeStyle = hsl(P.hue, P.saturation * 0.2, 0.24)
    ctx.lineWidth = 1
    ctx.strokeRect(sx0, boxT, sw, boxH)

    ctx.save()
    ctx.beginPath(); ctx.rect(sx0, boxT, sw, boxH); ctx.clip()
    const apex = sx0 + sw * 0.12
    const tip = sx0 + sw * 0.94
    const spread = this.S(0.0035 + 0.015 * jitNorm)
    ctx.globalAlpha = 0.40
    ctx.strokeStyle = P.inkDim
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(apex, mid); ctx.lineTo(tip, mid); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.strokeStyle = hsl(jitNorm > 0.55 ? 8 : 150, P.saturation * (0.6 + 0.7 * jitNorm), 0.52)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(apex, mid); ctx.lineTo(tip, mid - spread)
    ctx.moveTo(apex, mid); ctx.lineTo(tip, mid + spread)
    ctx.stroke()
    ctx.restore()

    ctx.font = `500 ${Math.max(7, this.S(0.0072))}px ui-monospace, monospace`
    ctx.fillStyle = P.inkDim
    ctx.textAlign = 'left'
    ctx.fillText('SCATTER', sx0, boxT - this.S(0.005))
    ctx.fillStyle = hsl(jitNorm > 0.55 ? 8 : 150, P.saturation * 0.9, 0.58)
    ctx.textAlign = 'right'
    ctx.fillText(`±${(m.nextJitter * 100).toFixed(2)}%`, sx0 + sw, boxT - this.S(0.005))
    ctx.textAlign = 'left'

    // Readiness lamp and label, above the rail rather than on top of the ball.
    ctx.fillStyle = ready >= 1
      ? hsl(150, P.saturation * 1.1, 0.55)
      : hsl(P.hue, P.saturation * 0.3, 0.14 + 0.24 * ready)
    ctx.beginPath()
    ctx.arc(x0 + w * 0.030, y0 + h * 0.20, Math.max(2, this.S(0.0034)), 0, TAU)
    ctx.fill()
    ctx.fillStyle = P.inkDim
    ctx.fillText('LAUNCHER', x0 + w * 0.055, y0 + h * 0.24)

    // ── the token counter ──
    // On the cabinet, where a real machine keeps its ball tray. The value shown
    // eases toward the truth so a payout is a visible count-UP, and a fresh
    // arrival glows. The number is never wrong for longer than a quarter
    // second, and the ledger in the panel is exact at all times.
    if (this._shownTokens === null) this._shownTokens = m.tokens
    if (m.tokens > this._lastTokens) this._tokGlow = 1
    this._lastTokens = m.tokens
    const dtok = m.tokens - this._shownTokens
    this._shownTokens += Math.abs(dtok) < 0.6 ? dtok : dtok * 0.16
    this._tokGlow = Math.max(0, this._tokGlow - 0.035)
    const glow = this._tokGlow * P.varnish
    const cx1 = sx0 + sw
    const cy1 = boxT + boxH + this.S(0.0115)
    const numStr = String(Math.round(this._shownTokens))
    ctx.font = `600 ${Math.max(10, this.S(0.0125 + 0.0018 * glow))}px ui-monospace, monospace`
    const numW = ctx.measureText(numStr).width
    ctx.fillStyle = glow > 0.02
      ? hsl(44, P.saturation * (0.6 + 0.7 * glow), 0.50 + 0.28 * glow)
      : hsl(P.hue, P.saturation * 0.25, 0.62)
    ctx.textAlign = 'right'
    ctx.fillText(numStr, cx1, cy1 + this.S(0.0005))
    // Label placed off the MEASURED number width — at small canvas sizes the
    // font floors kick in and a fixed offset collided with six digits.
    ctx.font = `500 ${Math.max(7, this.S(0.0068))}px ui-monospace, monospace`
    ctx.fillStyle = P.inkDim
    ctx.fillText('TOKENS', cx1 - numW - Math.max(5, this.S(0.004)), cy1)
    ctx.textAlign = 'left'
  }

  /** Is a canvas-CSS-pixel y inside the launcher cabinet strip? */
  inCabinet (cssY) { return cssY > this.Y(BOARD.h) }

  /**
   * Map a pointer x on the cabinet strip to a base-power setting, using the
   * same rail geometry the travel scale was drawn with. Returns 0..1, or null
   * before the first frame has published the rail.
   */
  dialFromX (cssX) {
    const r = this.dialRail
    if (!r) return null
    return Math.max(0, Math.min(1, (cssX - r.x0) / (r.x1 - r.x0)))
  }

  /**
   * The dial setting where the two routes are closest to a coin flip.
   *
   * Measured, not derived. Inverting the launch energy through the rail climb
   * puts this at 0.55; the machine crosses even odds at 0.19, because that
   * closed form ignores everything the ball loses rattling up the channel. This
   * tick was drawn in the wrong third of the dial until the measurement was run.
   */
  thresholdDial () { return coinFlipDial() }

  /**
   * The frame lamps — the parlour's electric weather, on the board's border
   * where a real cabinet carries its 電飾. Twenty lamps: twelve across the top,
   * four down each upper edge. Everything they do is read off real state:
   * breathing follows arousal, the chase is `inJackpot`, the slow alternation
   * is kakuhen, the convergence is a live reach, and the triple-pulse is a
   * heso burst. At varnish 0 they go dark — they are pure celebration, and
   * losing the light show is exactly what the switch is for.
   */
  lamps (ctx, P, m, dop, dt, effects = EFFECTS_PROFILE.full) {
    this.lampPulse = Math.max(0, this.lampPulse - dt / 0.9)
    const v = P.varnish
    if (v <= 0.01) return
    const t = this._t * effects.motion

    // Positions, built once: top row then upper sides.
    // Rebuilt when the board's readout claims margin space — lamps that fall
    // under a motif's marquee are dropped rather than drawn over the reels
    // (review finding: the parlour lights were shining on the instrument).
    const D = m.parts.displayRect || null
    const lampKey = D ? `${D.x0},${D.y0}` : 'stock'
    if (!this._lampPos || this._lampKey !== lampKey) {
      const pos = []
      for (let i = 0; i < 12; i++) pos.push({ x: 0.045 + (0.350 / 11) * i, y: 0.011 })
      for (let i = 0; i < 4; i++) pos.push({ x: 0.010, y: 0.055 + 0.045 * i })
      for (let i = 0; i < 4; i++) pos.push({ x: 0.430, y: 0.055 + 0.045 * i })
      this._lampPos = D
        ? pos.filter(p => !(p.x > D.x0 - 0.010 && p.x < D.x1 + 0.010 &&
                            p.y > D.y0 - 0.010 && p.y < D.y1 + 0.010))
        : pos
      this._lampKey = lampKey
    }
    const pos = this._lampPos
    const N = pos.length
    const reach = m.spin && m.spin.reach && m.spin.t / m.spin.dur > 0.58

    for (let i = 0; i < N; i++) {
      // Base breathing, phase-staggered so the frame shimmers rather than
      // blinks — and riding the WAVE: the whole frame lifts and quickens as
      // the tide comes in. Rate and brightness carry the build (the legal
      // channels), never pitch; and the crest promises nothing — it only
      // raises odds the display is simultaneously printing.
      const tide = waveW(m.wavePhase)
      let b = (0.05 + 0.30 * dop.arousal + 0.22 * tide) *
        (0.7 + 0.3 * Math.sin(t * (2.1 + 1.6 * tide) + i * 1.7))
      if (m.inJackpot && m.jackpot.fanfare > 0) {
        // Charging: the chase accelerates as the mouth approaches, and the
        // whole frame lifts. Rate carries the build, exactly as it does in
        // the audio — nothing here is pretending to predict anything.
        const k = 1 - m.jackpot.fanfare / 2.6
        b = ((i + Math.floor(t * (5 + 26 * k))) % 3 === 0) ? 1 : 0.06 + 0.30 * k
      } else if (m.inJackpot) {
        // The chase: every third lamp lit, marching.
        b = ((i + Math.floor(t * 14)) % 3 === 0) ? 1 : 0.10
      } else if (m.kakuhen > 0) {
        // Kakuhen: halves alternating, unhurried — the machine holding its breath.
        b = ((i % 2) === (Math.floor(t * 2) % 2)) ? 0.65 : 0.08
      } else if (reach) {
        // Reach: light converging on the middle of the top row, with the crawl.
        // The sides sit it out — the drama is over the display.
        if (i < 12) {
          // Converge on the READOUT, wherever this board keeps it — the
          // stock display centres at x 0.220 (index 5.5); a motif marquee
          // pulls the crawl toward its own corner.
          const rx = D ? (D.x0 + D.x1) / 2 : 0.220
          const ti = Math.max(0, Math.min(11, (rx - 0.045) * 11 / 0.350))
          const c = Math.min(1, Math.abs(i - ti) / 5.5)
          b = 1 - c * Math.min(1, 2 - 2 * (m.spin.t / m.spin.dur))
        } else b = 0.06
      }
      // A score burst rides on top of everything — except a reach's darkened
      // sides, which it would otherwise perpetually re-light at fast tempo.
      if (this.lampPulse > 0 && !(reach && i >= 12)) {
        b = Math.max(b, this.lampPulse * (0.45 + 0.55 * Math.sin(this.lampPulse * 21)))
      }
      const lit = Math.max(0, Math.min(1, b)) * v * effects.lamps
      if (lit < 0.03) continue
      const x = this.X(pos[i].x), y = this.Y(pos[i].y)
      const r = Math.max(1.6, this.S(0.0042))
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * (1.6 + 1.4 * lit))
      g.addColorStop(0, hsl(44, P.saturation * 1.25, 0.45 + 0.30 * lit, 0.9 * lit))
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, r * (1.6 + 1.4 * lit), 0, TAU); ctx.fill()
      ctx.fillStyle = hsl(44, P.saturation * 1.1, 0.30 + 0.45 * lit)
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
    }
  }

  /** Floating payout numbers: truth at every varnish, dressing only above it. */
  popupLayer (ctx, P, dt) {
    const v = P.varnish
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]
      p.t += dt
      const life = 1.05
      if (p.t > life) { this.popups.splice(i, 1); continue }
      const k = p.t / life
      const rise = this.S(0.014 + 0.022 * v) * k
      const alpha = v > 0.5 ? (1 - k) * (1 - k * 0.4) : 1 - k
      // A brief pop-in at high varnish; flat and small without it.
      const scale = v > 0.5 ? (k < 0.12 ? 0.55 + 3.75 * k : 1) : 0.85
      const fs = Math.max(9, this.S(0.0115 * p.w) * scale)
      ctx.globalAlpha = Math.max(0, alpha)
      ctx.font = `600 ${fs}px ui-monospace, Menlo, Consolas, monospace`
      ctx.textAlign = 'center'
      ctx.lineWidth = Math.max(2, fs * 0.22)
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.strokeText(p.text, this.X(p.x), this.Y(p.y) - rise)
      ctx.fillStyle = v > 0.5 ? hsl(44, P.saturation * 1.3, 0.68) : hsl(0, 0, 0.58)
      ctx.fillText(p.text, this.X(p.x), this.Y(p.y) - rise)
      ctx.globalAlpha = 1
    }
    ctx.textAlign = 'left'
  }

  /** Prediction-error flashes: the visible δ. */
  flashLayer (ctx, P, dt, effects = EFFECTS_PROFILE.full) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.t += dt
      const life = 0.55
      if (f.t > life) { this.flashes.splice(i, 1); continue }
      const k = 1 - f.t / life
      const R = this.S(0.010 + 0.055 * (1 - k) * Math.min(2, Math.abs(f.d)) * effects.motion)
      const warm = f.d >= 0
      ctx.globalAlpha = k * k * P.varnish * effects.flash
      ctx.strokeStyle = hsl(warm ? 44 : 214, warm ? 0.9 : 0.5, warm ? 0.62 : 0.5)
      ctx.lineWidth = Math.max(1, 3 * k)
      ctx.beginPath(); ctx.arc(this.X(f.x), this.Y(f.y), R, 0, TAU); ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}
