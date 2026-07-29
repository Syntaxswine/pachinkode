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

import { framePalette, trailColour, rippleColour, hsl, scoreColour, scoreTier } from './palette.js'
import { BOARD, coinFlipDial, routeOdds } from '../sim/board.js'

const TAU = Math.PI * 2
const TRAIL_MAX = 26

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
    this.bucketFlare = new Map()  // site → 0..1, decays; pure lacquer
    this.bucketTier = new Map()   // site → last score tier, for its rim colour
    this._t = 0
    this._shownTokens = null   // the counter's displayed value, easing to truth
    this._tokGlow = 0
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1)
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

  draw (machine, dop, varnish, dt, run = null) {
    const ctx = this.ctx
    const P = framePalette(dop, varnish)
    const w = this.cssW, h = this.cssH

    ctx.save()
    ctx.scale(this.dpr, this.dpr)

    // Screen shake, scaled by varnish — it is presentation, so it obeys the switch.
    this.shake = Math.max(0, this.shake - dt * 2.6)
    if (this.shake > 0.001 && varnish > 0) {
      const k = this.shake * this.shake * 5 * varnish
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k)
    }

    this.background(ctx, P, w, h, dop)
    this.iris(ctx, P, dop)
    this.boardFace(ctx, P)
    this.rail(ctx, P, machine)
    this.housing(ctx, P, machine)
    this.display(ctx, P, machine, dop)
    this.windmills(ctx, P, machine)
    this.nails(ctx, P, machine, dop)
    this.rippleLayer(ctx, P, dt)
    this.tulips(ctx, P, machine)
    this.attacker(ctx, P, machine)
    this.pockets(ctx, P, machine, dop)
    // Buckets decay on the frame clock, before they are drawn, so a site that
    // scored this frame renders at full flare rather than one frame stale.
    for (const [k, v] of this.bucketFlare) {
      const n = v - dt / 0.55
      if (n <= 0) this.bucketFlare.delete(k); else this.bucketFlare.set(k, n)
    }
    this.buckets(ctx, P, machine)
    this.trailsAndBalls(ctx, P, machine, dop, dt)
    this.flashLayer(ctx, P, dt)
    this.lamps(ctx, P, machine, dop, dt)
    this.popupLayer(ctx, P, dt)
    this.scorePopLayer(ctx, P, dt)
    this.chainMeter(ctx, P, run)
    this.quotaBar(ctx, P, run)
    this.launcher(ctx, P, machine)
    // Last, and additive: the room lighting up rather than a sheet over it.
    this.rewardWash(ctx, P, w, h, dt)

    ctx.restore()
    this._t += dt
  }

  /** Draws the pulse set by rewardPulse(). Additive, edge-weighted, gated. */
  rewardWash (ctx, P, w, h, dt) {
    this.pulse = Math.max(0, this.pulse - dt / 0.45)
    if (this.pulse < 0.01 || P.varnish <= 0.01) return
    const k = this.pulse * this.pulse            // ease out — a bloom, not a blink
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

  housing (ctx, P, m) {
    const H = m.parts.housing
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
    const H = m.parts.housing
    const pad = 0.016
    const x0 = this.X(H.x0 + pad), x1 = this.X(H.x1 - pad)
    const y0 = this.Y(H.y0 - 0.008), y1 = this.Y(H.y1 - 0.030)
    const w = x1 - x0, h = y1 - y0

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
    ctx.fillText(`抽選 LOTTERY 1/${m.odds}`, x0 + w / 2, y0 + h * 0.13)

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
    } else if (resFresh && res.kind === 'lose') {
      ctx.font = `500 ${Math.max(8, h * 0.10)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(P.hue, P.saturation * 0.3, 0.38)
      ctx.fillText('ハズレ  MISS', x0 + w / 2, y0 + h * 0.83)
    } else if (m.spin && m.spin.reach && m.spin.t / m.spin.dur > STOP[1]) {
      ctx.font = `500 ${Math.max(8, h * 0.11)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(44, P.saturation * 1.4, 0.55)
      ctx.fillText('リーチ  REACH', x0 + w / 2, y0 + h * 0.83)
    } else if (m.kakuhen > 0) {
      ctx.font = `500 ${Math.max(8, h * 0.10)}px ui-monospace, monospace`
      ctx.fillStyle = hsl(P.hue - 150, P.saturation * 1.2, 0.55)
      ctx.fillText(`確変 ${m.kakuhen}`, x0 + w / 2, y0 + h * 0.83)
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
    for (const n of m.parts.lifeNails) {
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
    if (!run) return
    const x0 = this.X(0.014), x1 = this.X(BOARD.w - 0.014)
    const y = this.Y(0.006)
    const p = run.progress
    const t = scoreTier(run.quota / 10)
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
  scorePop (x, y, n, chain = 1) {
    this.scorePops.push({ x, y, n, chain, t: 0, tier: scoreTier(n) })
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
      ctx.fillText(s.n.toLocaleString('en-US'), this.X(s.x), this.Y(s.y) - rise)
      ctx.restore()
    }
  }

  trailsAndBalls (ctx, P, m, dop, dt) {
    const live = new Set()
    for (const b of m.world.balls) {
      live.add(b.id)
      let tr = this.trails.get(b.id)
      if (!tr) this.trails.set(b.id, tr = [])
      tr.push({ x: b.x, y: b.y, v: dop.valueAt(b.x, b.y), c: dop.confidenceAt(b.x, b.y) })
      if (tr.length > TRAIL_MAX) tr.shift()
    }
    for (const id of [...this.trails.keys()]) {
      if (!live.has(id)) {
        const tr = this.trails.get(id)
        tr.shift(); tr.shift()
        if (tr.length < 2) this.trails.delete(id)
      }
    }

    ctx.lineCap = 'round'
    for (const tr of this.trails.values()) {
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i]
        const k = i / tr.length
        ctx.strokeStyle = trailColour(b.v, b.c * k, P.varnish)
        ctx.lineWidth = Math.max(0.6, this.S(0.0055) * 1.5 * k)
        ctx.beginPath()
        ctx.moveTo(this.X(a.x), this.Y(a.y))
        ctx.lineTo(this.X(b.x), this.Y(b.y))
        ctx.stroke()
      }
    }

    const r = this.S(0.0055)
    for (const b of m.world.balls) {
      const x = this.X(b.x), y = this.Y(b.y)
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
      g.addColorStop(0, '#fff')
      g.addColorStop(0.55, P.ball)
      g.addColorStop(1, `hsla(0 0% 28% / 1)`)
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
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
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(railL, mid + this.S(0.011)); ctx.lineTo(railR, mid + this.S(0.011)); ctx.stroke()
    for (let i = 0; i <= 10; i++) {
      const x = railL + span * (i / 10)
      const big = i % 5 === 0
      ctx.beginPath()
      ctx.moveTo(x, mid + this.S(0.011))
      ctx.lineTo(x, mid + this.S(big ? 0.017 : 0.014))
      ctx.stroke()
    }

    // The BASE thumb — the resting pull, where every quick tap fires from.
    // Drawn as a HANDLE, not a tick, because it is one: grip lines, a body
    // wide enough to see and to hit, and a pointer up to the scale. (A 3 px
    // triangle read as a readout; nobody dragged it. Review finding.)
    const baseX = railL + span * m.dial
    const thW = Math.max(11, this.S(0.010))
    const thH = Math.max(8, this.S(0.0068))
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
    const tDial = this.thresholdDial()
    if (tDial > 0 && tDial < 1) {
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
    if (jam) ctx.globalAlpha = 0.35
    ctx.fillStyle = hsl(212, P.saturation * 0.7, 0.42)
    ctx.fillRect(obX, obY - obH / 2, obW * (1 - pRight), obH)
    ctx.fillStyle = hsl(30, P.saturation * 0.9, 0.50)
    ctx.fillRect(obX + obW * (1 - pRight), obY - obH / 2, obW * pRight, obH)
    ctx.font = `500 ${Math.max(7, this.S(0.0072))}px ui-monospace, monospace`
    ctx.fillStyle = P.inkDim
    ctx.textAlign = 'right'
    ctx.fillText(`左 ${Math.round((1 - pRight) * 100)}`, obX - this.S(0.004), obY + this.S(0.003))
    ctx.textAlign = 'left'
    ctx.fillText(`${Math.round(pRight * 100)} 右${jam ? ' · solo' : ''}`, obX + obW + this.S(0.004), obY + this.S(0.003))
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
  lamps (ctx, P, m, dop, dt) {
    this.lampPulse = Math.max(0, this.lampPulse - dt / 0.9)
    const v = P.varnish
    if (v <= 0.01) return
    const t = this._t

    // Positions, built once: top row then upper sides.
    if (!this._lampPos) {
      const pos = []
      for (let i = 0; i < 12; i++) pos.push({ x: 0.045 + (0.350 / 11) * i, y: 0.011 })
      for (let i = 0; i < 4; i++) pos.push({ x: 0.010, y: 0.055 + 0.045 * i })
      for (let i = 0; i < 4; i++) pos.push({ x: 0.430, y: 0.055 + 0.045 * i })
      this._lampPos = pos
    }
    const pos = this._lampPos
    const N = pos.length
    const reach = m.spin && m.spin.reach && m.spin.t / m.spin.dur > 0.58

    for (let i = 0; i < N; i++) {
      // Base breathing, phase-staggered so the frame shimmers rather than blinks.
      let b = (0.05 + 0.30 * dop.arousal) * (0.7 + 0.3 * Math.sin(t * 2.1 + i * 1.7))
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
          const c = Math.abs(i - 5.5) / 5.5
          b = 1 - c * Math.min(1, 2 - 2 * (m.spin.t / m.spin.dur))
        } else b = 0.06
      }
      // A score burst rides on top of everything — except a reach's darkened
      // sides, which it would otherwise perpetually re-light at fast tempo.
      if (this.lampPulse > 0 && !(reach && i >= 12)) {
        b = Math.max(b, this.lampPulse * (0.45 + 0.55 * Math.sin(this.lampPulse * 21)))
      }
      const lit = Math.max(0, Math.min(1, b)) * v
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
  flashLayer (ctx, P, dt) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.t += dt
      const life = 0.55
      if (f.t > life) { this.flashes.splice(i, 1); continue }
      const k = 1 - f.t / life
      const R = this.S(0.010 + 0.055 * (1 - k) * Math.min(2, Math.abs(f.d)))
      const warm = f.d >= 0
      ctx.globalAlpha = k * k * P.varnish
      ctx.strokeStyle = hsl(warm ? 44 : 214, warm ? 0.9 : 0.5, warm ? 0.62 : 0.5)
      ctx.lineWidth = Math.max(1, 3 * k)
      ctx.beginPath(); ctx.arc(this.X(f.x), this.Y(f.y), R, 0, TAU); ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}
