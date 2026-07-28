// Rigid-body core. Law L1: this is bedrock — real units, real impulses.
//
// Units are SI throughout: metres, kilograms, seconds, radians. A pachinko ball
// is 11 mm across and 5.4 g, and the board is about half a metre tall, so every
// number in here is small. Resist the urge to work in pixels; the renderer scales
// at the last possible moment.
//
// Integration is semi-implicit (symplectic) Euler at a fixed 1200 Hz. That is
// deliberate overkill. Free fall over the board height reaches 3.10 m/s, but the
// real worst case is the launcher at full dial, 4.20 m/s — 3.5 mm per step against
// a 6.4 mm combined ball-plus-nail radius, so a head-on path still lands three or
// more samples inside the collision disc and nothing can tunnel through a nail.
// Contacts are resolved sequentially with a proper
// normal+friction impulse pair, which is what makes a ball spin off a nail instead
// of reflecting like light off a mirror.

import { closestOnSegment } from './vec.js'

export const DT = 1 / 1200
export const GRAVITY = 9.80665            // m/s², standard gravity
const MAX_SUBSTEPS = 60                   // spiral-of-death guard

// --- Ball constants -------------------------------------------------------
// These are not estimates. Japanese National Public Safety Commission Rule No. 4
// of 1985, appendix 4, specifies the ball exactly: 11.0 mm diameter, mass between
// 5.4 g and 5.7 g, steel, of uniform material (i.e. solid, not cored).
//
// The legal range has slack the physics does not: an 11.0 mm solid sphere of
// plain carbon steel (ρ = 7850 kg/m³) has a volume of 0.69691 cm³ and therefore
// weighs 5.471 g. The 5.7 g ceiling would require ρ = 8180 kg/m³, above any plain
// steel — it is tolerance headroom for plating and wear, not a real ball. So we
// use the density-derived figure rather than either end of the legal band.
export const BALL_R = 0.0055              // m   (11.0 mm diameter, exact by law)
export const BALL_M = 0.005471            // kg  (solid steel at 11.0 mm)
const BALL_I = 0.4 * BALL_M * BALL_R * BALL_R   // solid sphere, I = (2/5)mr²
const INV_M = 1 / BALL_M
const INV_I = 1 / BALL_I

// Angular drag.
//
// The tempting justification — "the ball is sandwiched against the glass" — is
// false, and the regulation cited above says so: board-to-glass must EXCEED
// 13 mm and not exceed 25 mm, which leaves an 11 mm ball between 2 and 14 mm of
// out-of-plane play. It is not pinched.
//
// The honest reason spin decays fast here and not in, say, pool is that the board
// is near-vertical: the ball rides against its face for most of its life and
// clatters off the glass on every lively bounce. The figure itself is a tuning
// knob, not a measurement, and is labelled as one.
const SPIN_DAMP = 2.2                     // 1/s — TUNED, not measured
const AIR_DRAG = 0.02                     // 1/s, linear; tiny but stops jitter accumulating

export const MAT = {
  // Restitution by surface pair. The nail figure is the good one: Sandeep et al.,
  // Canadian Geotechnical Journal 58(1):35–48 (2021), measured chrome steel spheres against a
  // brass block at 1.74–2.43 m/s — which overlaps the speed band a pachinko ball
  // strikes a nail at — and got e = 0.54, 0.53, 0.52, 0.51 across that range.
  //
  // One correction pushes it down: their spheres were ~2 mm and restitution falls
  // with sphere diameter, so an 11 mm ball sits below the measured figure. Hence
  // 0.50 rather than 0.52. (The regulation fixes nail brass at 150–230 HV, and an
  // earlier version of this comment claimed that softness as a second correction.
  // The paper never reports its block's hardness, so there is no basis to compare
  // — and 150–230 HV is the hard-drawn end of brass anyway, which would push COR
  // the other way. Noted, not applied.)
  //
  // The others are generic engineering values — no pachinko-specific measurement
  // of steel on plywood or acrylic exists. They are labelled honestly rather than
  // dressed up: if a future builder finds real numbers, these should move.
  nail: { e: 0.50, mu: 0.16 },   // MEASURED (steel→brass, size-corrected)
  wall: { e: 0.30, mu: 0.22 },   // generic steel→board
  rail: { e: 0.28, mu: 0.10 },   // generic steel→formed rail
  vane: { e: 0.40, mu: 0.30 },   // generic; grippier, the windmill must carry balls
  rubber: { e: 0.55, mu: 0.50 }, // the return wedge at the rail's end
  ball: { e: 0.65, mu: 0.10 }    // generic steel→steel at low speed
}

let nextId = 1

export function makeBall (x, y, vx = 0, vy = 0, meta = {}) {
  return {
    id: nextId++,
    x, y, vx, vy,
    w: 0,                  // angular velocity, rad/s
    a: 0,                  // angle, for rendering the spin
    r: BALL_R,
    alive: true,
    age: 0,
    hits: 0,               // nail strikes this life — drives the audio rain
    lastHitAge: 0,
    ...meta
  }
}

/**
 * The physical world: static nails and segments, dynamic rotors and gates, and
 * the balls. Game rules live in machine.js; this file only knows about shapes.
 */
export class World {
  constructor (bounds) {
    this.bounds = bounds          // {w, h} in metres
    this.balls = []
    this.nails = []               // {x, y, r, mat, bend:{dx,dy}}
    this.segments = []            // {ax, ay, bx, by, r, mat, id}
    this.rotors = []              // {x, y, r, blades, ang, spin, inertia, mat}
    this.sensors = []             // {kind, x, y, w, h, open, id} — axis-aligned mouths
    this.time = 0
    this.acc = 0
    this.events = []              // drained by machine.js each frame
    this._grid = null
    this._segGrid = null
    this._dynSegs = []
    this._queryStamp = 0
    this._cell = BALL_R * 4
    this._dirty = true
  }

  addNail (x, y, r = 0.0009) {
    this.nails.push({ x, y, r, mat: MAT.nail, bx: 0, by: 0 })
    this._dirty = true
    return this.nails[this.nails.length - 1]
  }

  addSegment (ax, ay, bx, by, r = 0.002, mat = MAT.wall, id = null) {
    this.segments.push({ ax, ay, bx, by, r, mat, id })
    this._dirty = true
    return this.segments[this.segments.length - 1]
  }

  /**
   * A free-spinning windmill (*fūsha*): `blades` capsule arms on a hub that
   * turns on a pin. Inertia is a real figure, not a tuning knob: a ~30 mm
   * plastic vane assembly of a few grams with its mass out near the rim comes
   * to order 10⁻⁶ kg·m². That smallness matters — it is why a single ball can
   * spin the thing up hard, and why the windmill is the board's loudest source
   * of chaos rather than a decoration.
   */
  addRotor (x, y, r, blades = 4, spin = 0) {
    const rotor = {
      x, y, r, blades, ang: 0, spin,
      inertia: 2.5e-6,            // kg·m²
      damp: 1.4,                  // 1/s, bushing friction
      cap: 80,                    // rad/s safety net; physical solve rarely reaches it
      mat: MAT.vane
    }
    this.rotors.push(rotor)
    return rotor
  }

  addSensor (kind, x, y, w, h, id = null) {
    const s = { kind, x, y, w, h, id, open: true, count: 0 }
    this.sensors.push(s)
    return s
  }

  spawn (ball) { this.balls.push(ball); return ball }

  emit (type, data) { this.events.push({ type, t: this.time, ...data }) }

  drainEvents () { const e = this.events; this.events = []; return e }

  /** Advance by real elapsed seconds, in fixed steps. Returns steps taken. */
  advance (elapsed) {
    this.acc += Math.min(elapsed, 0.25)
    let steps = 0
    while (this.acc >= DT && steps < MAX_SUBSTEPS) {
      this.step()
      this.acc -= DT
      steps++
    }
    if (steps === MAX_SUBSTEPS) this.acc = 0
    return steps
  }

  step () {
    const dt = DT
    this.time += dt

    if (this._dirty) this._buildGrid()

    // Rotors: free bodies with only angular DOF.
    for (const ro of this.rotors) {
      ro.spin -= ro.spin * ro.damp * dt
      ro.ang += ro.spin * dt
      if (ro.ang > Math.PI * 2) ro.ang -= Math.PI * 2
      else if (ro.ang < 0) ro.ang += Math.PI * 2
    }

    // Integrate.
    for (const b of this.balls) {
      if (!b.alive) continue
      b.vy += GRAVITY * dt
      const d = 1 - AIR_DRAG * dt
      b.vx *= d; b.vy *= d
      b.w -= b.w * SPIN_DAMP * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.a += b.w * dt
      b.age += dt
      b.lastHitAge += dt
    }

    // Contacts.
    for (const b of this.balls) {
      if (!b.alive) continue
      this._collideNails(b)
      this._collideSegments(b)
      this._collideRotors(b)
      this._collideBounds(b)
    }
    this._collideBalls()

    // Sensors last, so a ball that was just pushed out of a wall is judged in
    // its resolved position.
    for (const b of this.balls) {
      if (!b.alive) continue
      for (const s of this.sensors) {
        if (!s.open) continue
        if (b.x > s.x - s.w / 2 && b.x < s.x + s.w / 2 &&
            b.y > s.y - s.h / 2 && b.y < s.y + s.h / 2) {
          s.count++
          b.alive = false
          this.emit('sensor', { kind: s.kind, sensor: s.id, ball: b, x: b.x, y: b.y })
          break
        }
      }
    }

    // Reap.
    if (this.balls.length && this.balls.some(b => !b.alive)) {
      this.balls = this.balls.filter(b => b.alive)
    }
  }

  // --- collision primitives ------------------------------------------------

  /**
   * Resolve a ball against a static (or kinematically-driven) point contact.
   * `sx, sy` = contact surface velocity, which is how a spinning rotor throws
   * a ball rather than merely deflecting it.
   *
   * The normal impulse does not couple to the ball's spin — for a sphere the
   * lever arm is parallel to the normal — but the tangential impulse does, and
   * that coupling is the whole reason a pachinko ball squirts sideways off a
   * nail instead of bouncing back up the way it came.
   */
  _resolvePoint (b, nx, ny, pen, mat, sx = 0, sy = 0) {
    if (pen > 0) { b.x += nx * pen; b.y += ny * pen }

    // Velocity of the ball's material point at the contact, relative to surface.
    // Lever arm from centre to contact is (-nx, -ny) * r.
    const rx = -nx * b.r, ry = -ny * b.r
    // ω ẑ × r = ω(-ry, rx)
    const cvx = b.vx - b.w * ry - sx
    const cvy = b.vy + b.w * rx - sy

    const vn = cvx * nx + cvy * ny
    if (vn > 0) return 0                       // separating

    const jn = -(1 + mat.e) * vn * BALL_M
    b.vx += nx * jn * INV_M
    b.vy += ny * jn * INV_M

    // Tangential: Coulomb friction, clamped to μ|jn|.
    const tx = -ny, ty = nx
    const vt = cvx * tx + cvy * ty
    // Effective mass along t for a sphere pivoting about the contact:
    //   1/m_eff = 1/m + r²/I = 1/m + r²/(0.4 m r²) = 3.5/m
    const mEffT = BALL_M / 3.5
    let jt = -vt * mEffT
    const maxJt = mat.mu * Math.abs(jn)
    if (jt > maxJt) jt = maxJt
    else if (jt < -maxJt) jt = -maxJt

    b.vx += tx * jt * INV_M
    b.vy += ty * jt * INV_M
    // torque = r × F  (2-D scalar)
    b.w += (rx * (ty * jt) - ry * (tx * jt)) * INV_I

    return Math.abs(vn)                        // impact speed, for audio
  }

  _collideNails (b) {
    const cands = this._queryStatic(b.x, b.y)
    for (let i = 0; i < cands.length; i++) {
      const n = cands[i]
      const dx = b.x - (n.x + n.bx), dy = b.y - (n.y + n.by)
      const rr = b.r + n.r
      const d2 = dx * dx + dy * dy
      if (d2 >= rr * rr || d2 < 1e-18) continue
      const d = Math.sqrt(d2)
      const speed = this._resolvePoint(b, dx / d, dy / d, rr - d, n.mat)
      if (speed > 0.04) {
        b.hits++
        b.lastHitAge = 0
        this.emit('hit', { ball: b, x: b.x, y: b.y, speed, surface: 'nail', nail: n })
      }
    }
  }

  _collideSegments (b) {
    const cands = this._querySegments(b.x, b.y)
    for (let i = 0; i < cands.length; i++) {
      const s = cands[i]
      if (s.disabled) continue
      const c = closestOnSegment(b, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by })
      const dx = b.x - c.x, dy = b.y - c.y
      const rr = b.r + s.r
      const d2 = dx * dx + dy * dy
      if (d2 >= rr * rr) continue
      const d = Math.sqrt(d2) || 1e-9
      const speed = this._resolvePoint(b, dx / d, dy / d, rr - d, s.mat)
      if (speed > 0.06) {
        b.lastHitAge = 0
        this.emit('hit', { ball: b, x: b.x, y: b.y, speed, surface: 'wall', seg: s })
      }
    }
  }

  /**
   * Ball against a blade, solved as a genuine two-body contact.
   *
   * Treating the rotor as an infinite-mass wall and *then* adding a torque to it
   * would hand the rotor free angular momentum every strike — the ball rebounds
   * as though off a wall while the windmill spins up out of nothing. With an
   * inertia this small that error is not subtle; it is an energy pump. So the
   * rotor's inertia enters the impulse denominator directly.
   *
   * With contact point p, lever l = p − centre, and k = l × n, a normal impulse
   * jn changes the *relative* normal speed at the contact by jn·(1/m + k²/I).
   * Same construction on the tangent, where the ball's own spin inertia joins in.
   */
  _collideRotors (b) {
    for (const ro of this.rotors) {
      const ddx = b.x - ro.x, ddy = b.y - ro.y
      const reach = ro.r + b.r + 0.004
      if (ddx * ddx + ddy * ddy > reach * reach) continue

      for (let k = 0; k < ro.blades; k++) {
        const th = ro.ang + (k * Math.PI * 2) / ro.blades
        const ex = ro.x + Math.cos(th) * ro.r
        const ey = ro.y + Math.sin(th) * ro.r
        const c = closestOnSegment(b, { x: ro.x, y: ro.y }, { x: ex, y: ey })
        const dx = b.x - c.x, dy = b.y - c.y
        const rr = b.r + 0.0022
        const d2 = dx * dx + dy * dy
        if (d2 >= rr * rr) continue
        const d = Math.sqrt(d2) || 1e-9
        const nx = dx / d, ny = dy / d
        const pen = rr - d

        // Push the ball out; the rotor has no translational freedom to share it.
        b.x += nx * pen
        b.y += ny * pen

        const lx = c.x - ro.x, ly = c.y - ro.y
        const invI = 1 / ro.inertia

        // Ball's contact-point velocity (centre motion + own spin).
        const brx = -nx * b.r, bry = -ny * b.r
        const bvx = b.vx - b.w * bry
        const bvy = b.vy + b.w * brx
        // Blade's contact-point velocity: ω ẑ × l.
        const svx = -ro.spin * ly, svy = ro.spin * lx

        const rvx = bvx - svx, rvy = bvy - svy
        const vn = rvx * nx + rvy * ny
        if (vn > 0) continue

        const kn = lx * ny - ly * nx                  // l × n
        const invMn = INV_M + kn * kn * invI
        const jn = -(1 + ro.mat.e) * vn / invMn
        b.vx += nx * jn * INV_M
        b.vy += ny * jn * INV_M
        ro.spin -= jn * kn * invI                     // reaction: −jn n at l

        const tx = -ny, ty = nx
        const vt = rvx * tx + rvy * ty
        const kt = lx * ty - ly * tx                  // l × t
        const invMt = INV_M + (b.r * b.r) * INV_I + kt * kt * invI
        let jt = -vt / invMt
        const maxJt = ro.mat.mu * Math.abs(jn)
        if (jt > maxJt) jt = maxJt
        else if (jt < -maxJt) jt = -maxJt

        b.vx += tx * jt * INV_M
        b.vy += ty * jt * INV_M
        b.w += (brx * (ty * jt) - bry * (tx * jt)) * INV_I
        ro.spin -= jt * kt * invI

        if (ro.spin > ro.cap) ro.spin = ro.cap
        else if (ro.spin < -ro.cap) ro.spin = -ro.cap

        const speed = Math.abs(vn)
        if (speed > 0.04) {
          b.lastHitAge = 0
          this.emit('hit', { ball: b, x: b.x, y: b.y, speed, surface: 'vane', rotor: ro })
        }
      }
    }
  }

  _collideBounds (b) {
    const { w, h } = this.bounds
    if (b.x < b.r) this._resolvePoint(b, 1, 0, b.r - b.x, MAT.wall)
    else if (b.x > w - b.r) this._resolvePoint(b, -1, 0, b.x - (w - b.r), MAT.wall)
    if (b.y < b.r) this._resolvePoint(b, 0, 1, b.r - b.y, MAT.wall)
    else if (b.y > h + 0.05) {
      // Fell off the bottom without hitting a sensor — the out hole caught it.
      b.alive = false
      this.emit('sensor', { kind: 'out', sensor: 'floor', ball: b, x: b.x, y: b.y })
    }
    // A real machine has no permanently wedged ball; a simulated one does, and a
    // stuck ball would quietly poison every statistic the harness reports. Drain
    // it under its own label so it appears in the tally rather than hiding inside
    // the 'out' count. If this number is ever non-trivial, the board has a trap.
    if (b.alive && b.age > 40) {
      b.alive = false
      this.emit('sensor', { kind: 'stuck', sensor: 'reaper', ball: b, x: b.x, y: b.y })
    }
  }

  _collideBalls () {
    const live = this.balls
    if (live.length < 2) return
    const cell = this._cell
    const buckets = new Map()
    for (let i = 0; i < live.length; i++) {
      const b = live[i]
      if (!b.alive) continue
      const key = ((b.x / cell) | 0) * 73856093 ^ ((b.y / cell) | 0) * 19349663
      let arr = buckets.get(key)
      if (!arr) buckets.set(key, arr = [])
      arr.push(i)
    }
    const seen = new Set()
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      if (!a.alive) continue
      const cx = (a.x / cell) | 0, cy = (a.y / cell) | 0
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = buckets.get((cx + ox) * 73856093 ^ (cy + oy) * 19349663)
          if (!arr) continue
          for (let k = 0; k < arr.length; k++) {
            const j = arr[k]
            if (j <= i) continue
            const pk = i * 100003 + j
            if (seen.has(pk)) continue
            seen.add(pk)
            this._pairBalls(a, live[j])
          }
        }
      }
    }
  }

  _pairBalls (a, b) {
    if (!a.alive || !b.alive) return
    const dx = b.x - a.x, dy = b.y - a.y
    const rr = a.r + b.r
    const d2 = dx * dx + dy * dy
    if (d2 >= rr * rr || d2 < 1e-18) return
    const d = Math.sqrt(d2)
    const nx = dx / d, ny = dy / d
    const pen = (rr - d) * 0.5
    a.x -= nx * pen; a.y -= ny * pen
    b.x += nx * pen; b.y += ny * pen

    // Contact-point velocities including spin.
    const arx = nx * a.r, ary = ny * a.r
    const brx = -nx * b.r, bry = -ny * b.r
    const avx = a.vx - a.w * ary, avy = a.vy + a.w * arx
    const bvx = b.vx - b.w * bry, bvy = b.vy + b.w * brx
    const rvx = bvx - avx, rvy = bvy - avy
    const vn = rvx * nx + rvy * ny
    if (vn > 0) return

    const e = MAT.ball.e
    const jn = -(1 + e) * vn / (INV_M + INV_M)
    a.vx -= nx * jn * INV_M; a.vy -= ny * jn * INV_M
    b.vx += nx * jn * INV_M; b.vy += ny * jn * INV_M

    const tx = -ny, ty = nx
    const vt = rvx * tx + rvy * ty
    // 1/m_eff = 2*(1/m) + 2*r²/I  for two equal spheres
    const mEffT = 1 / (2 * INV_M + 2 * a.r * a.r * INV_I)
    let jt = -vt * mEffT
    const maxJt = MAT.ball.mu * Math.abs(jn)
    if (jt > maxJt) jt = maxJt
    else if (jt < -maxJt) jt = -maxJt

    a.vx -= tx * jt * INV_M; a.vy -= ty * jt * INV_M
    b.vx += tx * jt * INV_M; b.vy += ty * jt * INV_M
    a.w -= (arx * (ty * jt) - ary * (tx * jt)) * INV_I
    b.w += (brx * (ty * jt) - bry * (tx * jt)) * INV_I

    const speed = Math.abs(vn)
    if (speed > 0.10) {
      this.emit('hit', { ball: a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed, surface: 'ball' })
    }
  }

  // --- static broadphase ---------------------------------------------------

  /**
   * Broadphase for the static world.
   *
   * Both nails and wall segments go into a uniform grid. The segments matter more
   * than they look: a finished board has ~380 of them (the rail alone is 233
   * chords, 153 outer and 80 inner), and testing every ball against every segment on every one of 1200
   * steps per second was costing more than the rest of the simulation combined.
   * Segments are rasterised by bounding box, which is exact enough when the
   * longest one is a fraction of the board.
   */
  _buildGrid () {
    const cell = this._cell
    const g = new Map()
    for (const n of this.nails) {
      const key = (((n.x + n.bx) / cell) | 0) * 73856093 ^ (((n.y + n.by) / cell) | 0) * 19349663
      let arr = g.get(key)
      if (!arr) g.set(key, arr = [])
      arr.push(n)
    }
    this._grid = g

    // Segments that move every frame (tulip wings) cannot live in a static grid.
    // There are four of them, so they are simply always tested.
    this._dynSegs = this.segments.filter(s => s.dynamic)

    const sg = new Map()
    for (const s of this.segments) {
      if (s.dynamic) continue
      const pad = s.r + 0.001
      const x0 = ((Math.min(s.ax, s.bx) - pad) / cell) | 0
      const x1 = ((Math.max(s.ax, s.bx) + pad) / cell) | 0
      const y0 = ((Math.min(s.ay, s.by) - pad) / cell) | 0
      const y1 = ((Math.max(s.ay, s.by) + pad) / cell) | 0
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx * 73856093 ^ cy * 19349663
          let arr = sg.get(key)
          if (!arr) sg.set(key, arr = [])
          arr.push(s)
        }
      }
    }
    this._segGrid = sg
    this._dirty = false
  }

  _querySegments (x, y) {
    const cell = this._cell
    const cx = (x / cell) | 0, cy = (y / cell) | 0
    const out = this._dynSegs.slice()
    const stamp = ++this._queryStamp
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = this._segGrid.get((cx + ox) * 73856093 ^ (cy + oy) * 19349663)
        if (!arr) continue
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i]
          if (s._stamp === stamp) continue     // a segment can span several cells
          s._stamp = stamp
          out.push(s)
        }
      }
    }
    return out
  }

  _queryStatic (x, y) {
    const cell = this._cell
    const cx = (x / cell) | 0, cy = (y / cell) | 0
    const out = []
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = this._grid.get((cx + ox) * 73856093 ^ (cy + oy) * 19349663)
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i])
      }
    }
    return out
  }

  markDirty () { this._dirty = true }
}
