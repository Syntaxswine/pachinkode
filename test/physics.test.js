import test from 'node:test'
import assert from 'node:assert/strict'
import { World, makeBall, MAT, BALL_R, DT, GRAVITY } from '../src/sim/world.js'
import { makeRng } from '../src/sim/rng.js'

const run = (world, seconds) => {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) world.step()
  return world
}

test('rng: same seed, same stream', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43)
  const sa = Array.from({ length: 8 }, a)
  const sb = Array.from({ length: 8 }, b)
  const sc = Array.from({ length: 8 }, c)
  assert.deepEqual(sa, sb)
  assert.notDeepEqual(sa, sc)
  for (const x of sa) assert.ok(x >= 0 && x < 1, `out of range: ${x}`)
})

test('rng: roughly uniform over 200k draws', () => {
  const r = makeRng('uniformity')
  const bins = new Array(10).fill(0)
  const N = 200000
  for (let i = 0; i < N; i++) bins[Math.floor(r() * 10)]++
  for (const b of bins) {
    // ±3% of the 20000 expected is a very loose gate; we are catching gross bias.
    assert.ok(Math.abs(b - N / 10) < N / 10 * 0.03, `bin skew: ${bins}`)
  }
})

test('free fall matches the closed-form solution, drag and all', () => {
  const w = new World({ w: 1, h: 100 })
  const b = w.spawn(makeBall(0.5, 0.1))
  const T = 0.5
  run(w, T)

  // The world applies a small linear drag, so the reference is not ½gt² but the
  // solution of v' = g − kv:  v = (g/k)(1 − e^{−kt}),  y = y₀ + (g/k)[t − (1−e^{−kt})/k].
  // Semi-implicit Euler then sits above that by a known bias of g·dt·t/2.
  // Asserting against *that* — rather than a loose tolerance around ½gt² — is
  // what makes this a test of the integrator instead of a test of nothing.
  const k = 0.02
  const vTerm = GRAVITY / k
  const decay = 1 - Math.exp(-k * T)
  const yAnalytic = 0.1 + vTerm * (T - decay / k)
  const eulerBias = GRAVITY * DT * T / 2
  const expected = yAnalytic + eulerBias

  assert.ok(Math.abs(b.y - expected) < 2e-4, `y=${b.y} expected≈${expected}`)
  assert.ok(Math.abs(b.vy - vTerm * decay) < 5e-3, `vy=${b.vy} expected≈${vTerm * decay}`)
})

test('bounce height respects the coefficient of restitution', () => {
  const w = new World({ w: 1, h: 10 })
  const floorY = 0.5
  w.addSegment(0, floorY, 1, floorY, 0.002, MAT.wall)
  const h0 = 0.4
  const b = w.spawn(makeBall(0.5, floorY - 0.002 - BALL_R - h0))
  // Fall, bounce, and find the apex of the first rebound.
  let apex = 1e9
  let bounced = false
  for (let i = 0; i < 4000; i++) {
    const prevVy = b.vy
    w.step()
    if (prevVy > 0 && b.vy < 0) bounced = true
    if (bounced) {
      apex = Math.min(apex, b.y)
      if (b.vy > 0) break
    }
  }
  const rebound = (floorY - 0.002 - BALL_R) - apex
  const predicted = h0 * MAT.wall.e * MAT.wall.e
  // Air drag shaves a little; accept 12% under, nothing over.
  assert.ok(rebound <= predicted * 1.02, `rebound ${rebound} > predicted ${predicted}`)
  assert.ok(rebound >= predicted * 0.88, `rebound ${rebound} << predicted ${predicted}`)
})

test('a nail strike converts some linear motion into spin', () => {
  const w = new World({ w: 1, h: 10 })
  w.addNail(0.5, 0.5)
  // Aim off-centre so there is a tangential component to grip.
  const b = w.spawn(makeBall(0.5 - 0.004, 0.5 - 0.08, 0, 2.0))
  run(w, 0.12)
  assert.ok(Math.abs(b.w) > 1, `expected spin, got w=${b.w}`)
  // And it should have been deflected sideways, not reflected straight back.
  assert.ok(Math.abs(b.vx) > 0.05, `expected lateral deflection, vx=${b.vx}`)
})

test('no tunnelling: fast balls through a dense nail field stay inside', () => {
  const w = new World({ w: 0.44, h: 0.6 })
  for (let row = 0; row < 22; row++) {
    for (let col = 0; col < 16; col++) {
      const x = 0.012 + col * 0.027 + (row % 2 ? 0.0135 : 0)
      const y = 0.06 + row * 0.023
      if (x < 0.43) w.addNail(x, y)
    }
  }
  const rng = makeRng('tunnel')
  for (let i = 0; i < 40; i++) {
    w.spawn(makeBall(rng.range(0.05, 0.39), 0.02, rng.range(-3, 3), rng.range(0, 6)))
  }
  for (let i = 0; i < 6000; i++) {
    w.step()
    for (const b of w.balls) {
      assert.ok(b.x > -0.001 && b.x < 0.441, `escaped in x: ${b.x}`)
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'NaN in state')
      assert.ok(Math.abs(b.vx) < 40 && Math.abs(b.vy) < 40, `energy blew up: ${b.vx},${b.vy}`)
    }
  }
})

test('the simulation is deterministic', () => {
  const build = () => {
    const w = new World({ w: 0.44, h: 0.6 })
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 14; col++) {
        w.addNail(0.02 + col * 0.03 + (row % 2 ? 0.015 : 0), 0.08 + row * 0.035)
      }
    }
    w.addRotor(0.22, 0.30, 0.02, 4, 3)
    const rng = makeRng(1234)
    for (let i = 0; i < 12; i++) {
      w.spawn(makeBall(rng.range(0.08, 0.36), 0.02, rng.range(-1, 1), rng.range(1, 3)))
    }
    return w
  }
  const a = build(), b = build()
  for (let i = 0; i < 3000; i++) { a.step(); b.step() }
  assert.equal(a.balls.length, b.balls.length)
  for (let i = 0; i < a.balls.length; i++) {
    assert.equal(a.balls[i].x, b.balls[i].x, 'x diverged')
    assert.equal(a.balls[i].y, b.balls[i].y, 'y diverged')
    assert.equal(a.balls[i].w, b.balls[i].w, 'spin diverged')
  }
  assert.equal(a.rotors[0].ang, b.rotors[0].ang, 'rotor diverged')
})

test('a windmill spun by a falling ball throws it sideways', () => {
  const w = new World({ w: 0.44, h: 0.9 })
  const ro = w.addRotor(0.22, 0.40, 0.028, 4, 0)
  ro.ang = 0.4
  const b = w.spawn(makeBall(0.22 + 0.02, 0.28, 0, 1.5))
  run(w, 0.35)
  assert.ok(Math.abs(ro.spin) > 2, `rotor did not take up spin: ${ro.spin}`)
  assert.ok(Math.abs(b.vx) > 0.05, `ball was not redirected: vx=${b.vx}`)
})

test('the windmill is not an energy pump', () => {
  // The bug this guards: resolving the ball against the blade as if the blade
  // were an immovable wall, then *also* torquing the blade, invents angular
  // momentum on every strike. With a rotor inertia in the 10⁻⁶ range that error
  // compounds into a board that flings balls upward forever. Total mechanical
  // energy must never exceed what the ball arrived with.
  const w = new World({ w: 0.44, h: 1000 })   // no floor, no walls in reach
  const ro = w.addRotor(0.22, 0.40, 0.028, 4, 0)
  const m = 0.0054
  const b = w.spawn(makeBall(0.22 + 0.018, 0.30, 0, 2.5))

  const energy = () => {
    const ball = w.balls[0]
    if (!ball) return 0
    const kin = 0.5 * m * (ball.vx * ball.vx + ball.vy * ball.vy)
    const spin = 0.5 * (0.4 * m * ball.r * ball.r) * ball.w * ball.w
    const pot = m * GRAVITY * (1000 - ball.y)          // datum well below
    const rot = 0.5 * ro.inertia * ro.spin * ro.spin
    return kin + spin + pot + rot
  }

  const e0 = energy()
  let worst = 0
  for (let i = 0; i < 1200; i++) {
    w.step()
    if (!w.balls.length) break
    worst = Math.max(worst, energy() - e0)
  }
  // Allow a hair for the positional-correction push-out doing work; anything
  // beyond a fraction of a millijoule means the contact solve is manufacturing it.
  assert.ok(worst < 2e-4, `energy created: +${worst.toExponential(2)} J`)
})

test('sensors capture balls and emit an event', () => {
  const w = new World({ w: 0.44, h: 0.9 })
  w.addSensor('chucker', 0.22, 0.5, 0.03, 0.02, 'start')
  w.spawn(makeBall(0.22, 0.3, 0, 0.5))
  run(w, 0.8)
  const ev = w.drainEvents().filter(e => e.type === 'sensor')
  assert.equal(ev.length, 1)
  assert.equal(ev[0].kind, 'chucker')
  assert.equal(w.balls.length, 0)
})

test('balls collide with each other and conserve momentum in the pair', () => {
  const w = new World({ w: 1, h: 1000 })   // deep box: no floor interference
  const a = w.spawn(makeBall(0.4, 0.5, 1.0, 0))
  const b = w.spawn(makeBall(0.4 + 2 * BALL_R + 0.001, 0.5, -1.0, 0))
  const p0 = a.vx + b.vx
  run(w, 0.05)
  const p1 = a.vx + b.vx
  assert.ok(Math.abs(p1 - p0) < 1e-3, `x-momentum drifted: ${p0} -> ${p1}`)
  assert.ok(a.vx < 0 && b.vx > 0, 'balls did not rebound off each other')
})
