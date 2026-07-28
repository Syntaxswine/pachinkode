// Canvas 2D renderer.
//
// Reads the world, the parts, and the dopamine model. Writes pixels. It must
// never write back into any of them — the varnish-neutrality test depends on
// this file being a pure observer.
//
// The one image everything else serves: a ball's trail is coloured by V(s), the
// machine's learned estimate of what a ball in that position is worth, and its
// alpha by the machine's confidence in that estimate. When the ball lands, the
// difference between the trail's colour and what it actually paid is exactly the
// prediction error, and that difference is what flashes. You are watching a
// dopamine signal happen, in colour, on a board that taught itself the map.

import { framePalette, trailColour, hsl } from './palette.js'
import { BOARD, coinFlipDial, routeOdds } from '../sim/board.js'

const TAU = Math.PI * 2
const TRAIL_MAX = 26

export class Renderer {
  constructor (canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.trails = new Map()
    this.flashes = []
    this.shake = 0
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

  draw (machine, dop, varnish, dt) {
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
    this.tulips(ctx, P, machine)
    this.attacker(ctx, P, machine)
    this.pockets(ctx, P, machine, dop)
    this.trailsAndBalls(ctx, P, machine, dop, dt)
    this.flashLayer(ctx, P, dt)
    this.launcher(ctx, P, machine)

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
    ctx.font = `500 ${fs}px ui-monospace, Menlo, Consolas, monospace`

    // Reel stop schedule, as a fraction of the spin. The middle reel is last and
    // slowest — that lateness IS the near-miss.
    const STOP = [0.34, 0.58]
    for (let i = 0; i < 3; i++) {
      const cx = x0 + cellW * (i + 0.5)
      let glyph, bright
      if (!m.spin) {
        glyph = m.lastSymbols ? m.lastSymbols[i] : '·'
        bright = 0.20
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

    if (m.spin && m.spin.reach && m.spin.t / m.spin.dur > STOP[1]) {
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
   * Everything drawn here is real state read off the Machine. The hammer's draw
   * is `dial`, its strike is `hammer`, the readiness lamp is `readiness`, and the
   * scatter arc is `nextJitter` — the actual standard deviation the next shot
   * will be given. The threshold tick is `thresholdCrestSpeed()` solved back
   * through the rail climb, so it marks the true boundary between the two routes.
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
      ctx.fillText('50:50', tx, mid + this.S(0.030))
      ctx.textAlign = 'left'
    }

    // The live route odds at the current dial, drawn as a split bar above the
    // rail. The split is genuine — this is measured behaviour, not a model — and
    // it is the honest replacement for a LEFT/RIGHT label that was pretending the
    // boundary is sharp.
    const pRight = routeOdds(m.dial)
    const obY = y0 + h * 0.20
    const obX = x0 + w * 0.22, obW = w * 0.34, obH = this.S(0.006)
    ctx.fillStyle = hsl(212, P.saturation * 0.7, 0.42)
    ctx.fillRect(obX, obY - obH / 2, obW * (1 - pRight), obH)
    ctx.fillStyle = hsl(30, P.saturation * 0.9, 0.50)
    ctx.fillRect(obX + obW * (1 - pRight), obY - obH / 2, obW * pRight, obH)
    ctx.font = `500 ${Math.max(7, this.S(0.0072))}px ui-monospace, monospace`
    ctx.fillStyle = P.inkDim
    ctx.textAlign = 'right'
    ctx.fillText(`左 ${Math.round((1 - pRight) * 100)}`, obX - this.S(0.004), obY + this.S(0.003))
    ctx.textAlign = 'left'
    ctx.fillText(`${Math.round(pRight * 100)} 右`, obX + obW + this.S(0.004), obY + this.S(0.003))

    // ── the hammer ──
    // Drawn back in proportion to the dial, snapping forward on a shot.
    const draw = m.dial
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
