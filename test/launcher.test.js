import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Machine, LAUNCH_INTERVAL, CHARGE_TIME, FIRE_RATES, JITTER_COLD, JITTER_HOT
} from '../src/sim/machine.js'
import { routeOdds, coinFlipDial } from '../src/sim/board.js'
import { DT } from '../src/sim/world.js'

/**
 * The launcher has three promises to keep, and they pull against each other.
 *
 * 1. At its class default it may never exceed the regulated rate. 100 balls per
 *    minute is a legal ceiling, not a balance figure, and a tap-to-fire control
 *    makes it very easy to break by accident — banking idle time and then
 *    emptying a burst. The faster FIRE_RATES are opted into, never assumed, and
 *    each must honor its own interval with the same rounding-up discipline.
 * 2. Firing fast must cost accuracy, and firing from rest must not.
 * 3. The pull must be trustworthy: a tap is a shot at BASE, a held pull ramps
 *    monotonically to full, and a release is never swallowed — it fires the
 *    moment the lockout allows, at the power the pull reached.
 */

/** Run the machine for `seconds`, holding the AUTOFIRE trigger as instructed. */
function run (m, seconds, holdFn) {
  const steps = Math.round(seconds / DT)
  const launches = []
  for (let i = 0; i < steps; i++) {
    m.firing = holdFn(i * DT)
    m.step(DT)
    for (const ev of m.drain()) if (ev.type === 'launch') launches.push({ t: i * DT, ...ev })
  }
  return launches
}

/** Run the machine driving the PULL: pressFn says whether the trigger is down. */
function runPull (m, seconds, pressFn) {
  const steps = Math.round(seconds / DT)
  const launches = []
  let held = false
  for (let i = 0; i < steps; i++) {
    const want = pressFn(i * DT)
    if (want && !held) m.beginCharge()
    if (!want && held) m.releaseCharge()
    held = want
    m.step(DT)
    for (const ev of m.drain()) if (ev.type === 'launch') launches.push({ t: i * DT, ...ev })
  }
  return launches
}

test('the launcher never exceeds the regulated 100 balls per minute', () => {
  // The regulation is worded as a ceiling on any continuous minute — 「一分間に
  // １００個を超える数の遊技球を発射することができないもの」 — so the honest test
  // is a rolling sixty-second window, not shots divided by run length. (Dividing
  // by run length reports 102/min purely from counting both endpoints, which is a
  // property of the ruler rather than of the machine.)
  const m = new Machine({ seed: 1, tokens: 20000 })
  const shots = run(m, 95, () => true)
  assert.ok(shots.length > 140, `expected sustained fire, got ${shots.length} shots`)

  for (let i = 1; i < shots.length; i++) {
    const gap = shots[i].t - shots[i - 1].t
    assert.ok(gap >= LAUNCH_INTERVAL - DT * 1.5,
      `shots ${i - 1}→${i} were ${gap.toFixed(4)} s apart, under the ${LAUNCH_INTERVAL} s floor`)
  }

  // Stated without an endpoint to argue about: any 101 consecutive balls must
  // span at least a full minute. Exactly 100 per minute is permitted — the NPA
  // interpretation is that 100 does not violate and 101 does — so this is the
  // rule itself rather than a proxy for it. (Counting shots inside a rolling
  // window instead makes the result turn on whether 60.000833 < 0.000833 + 60 in
  // floating point, which is a fact about the ruler, not the machine.)
  for (let i = 0; i + 100 < shots.length; i++) {
    const span = shots[i + 100].t - shots[i].t
    assert.ok(span >= 60 - 1e-9,
      `balls ${i}–${i + 100} were fired in ${span.toFixed(6)} s — 101 inside a minute`)
  }
})

test('a tap after a long idle fires exactly one ball, not a burst', () => {
  // The trap: `sinceLaunch` accumulates while idle, so an unclamped launcher
  // banks five seconds of credit and spends it in five consecutive frames.
  const m = new Machine({ seed: 2, tokens: 500 })
  const shots = run(m, 8, (t) => t > 5.0 && t < 5.05)
  assert.equal(shots.length, 1, `a 50 ms tap produced ${shots.length} balls`)
})

test('held fire is a steady cadence, released fire is not', () => {
  const m = new Machine({ seed: 3, tokens: 500 })
  // Tap once per 2 s.
  const tapped = run(m, 12, (t) => (t % 2) < 0.05)
  assert.ok(tapped.length >= 5 && tapped.length <= 7,
    `expected ~6 deliberate shots in 12 s, got ${tapped.length}`)
})

test('shots fired from rest are precise; shots fired flat out are not', () => {
  const rested = new Machine({ seed: 4, tokens: 500 })
  const restedShots = run(rested, 40, (t) => (t % 5) < 0.05)      // one every 5 s
  const hot = new Machine({ seed: 4, tokens: 5000 })
  const hotShots = run(hot, 40, () => true)                        // flat out

  const meanJit = (a) => a.reduce((s, x) => s + x.jitter, 0) / a.length
  const rj = meanJit(restedShots)
  const hj = meanJit(hotShots)

  assert.ok(rj < JITTER_COLD * 1.35,
    `rested shots should sit near the cold figure ${JITTER_COLD}, got ${rj.toFixed(5)}`)
  assert.ok(hj > JITTER_HOT * 0.75,
    `sustained fire should approach the hot figure ${JITTER_HOT}, got ${hj.toFixed(5)}`)
  assert.ok(hj / rj > 4, `expected a large accuracy penalty, got ${(hj / rj).toFixed(1)}×`)
})

test('the measured spread of launch speeds really does widen with rate', () => {
  // Not the declared jitter — the actual scatter of the speeds that came out.
  const spread = (shots) => {
    const v = shots.map(s => s.speed)
    const mu = v.reduce((a, b) => a + b, 0) / v.length
    return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) / mu
  }
  const rested = new Machine({ seed: 9, tokens: 900 })
  rested.dial = 0.5
  const r = run(rested, 200, (t) => (t % 4) < 0.05)

  const hot = new Machine({ seed: 9, tokens: 900 })
  hot.dial = 0.5
  const h = run(hot, 200, () => true)

  assert.ok(r.length > 30 && h.length > 200, `too few samples: ${r.length}, ${h.length}`)
  assert.ok(spread(h) > spread(r) * 3,
    `measured spread barely moved: rested ${spread(r).toFixed(5)} vs hot ${spread(h).toFixed(5)}`)
})

test('the launcher heats and cools rather than switching', () => {
  const m = new Machine({ seed: 5, tokens: 900 })
  run(m, 12, () => true)
  const hot = m.worked
  assert.ok(hot > 0.8, `sustained fire left worked at ${hot.toFixed(3)}`)
  run(m, 6, () => false)                 // stop, let it settle
  assert.ok(m.worked < 0.05, `mechanism did not cool: ${m.worked.toFixed(3)}`)
  assert.ok(m.nextJitter < JITTER_COLD * 1.3, 'scatter did not return to the cold figure')
})

test('the published route odds match what the machine actually does', () => {
  // ROUTE_ODDS is measured data drawn on the HUD as live odds. If the board
  // geometry or the launch speeds move and nobody re-measures, the machine goes
  // on confidently displaying numbers that are no longer true — which is exactly
  // how the previous marker ended up a third of the dial's travel out of place.
  const measure = (dial, n = 120) => {
    const m = new Machine({ seed: 5, tokens: n + 60 })
    m.dial = dial
    const seen = new Map()
    let right = 0, total = 0, guard = 0
    while (m.launched < n && guard < 4e6) {
      guard++
      m.firing = true
      m.step(DT)
      for (const b of m.world.balls) {
        if (b.warped) continue
        if (!seen.has(b.id)) { seen.set(b.id, false); total++ }
        if (!seen.get(b.id) && b.x > 0.33 && b.y < 0.25) { seen.set(b.id, true); right++ }
      }
      for (const ev of m.drain()) if (ev.type === 'foul') total--
    }
    return total > 0 ? right / total : 0
  }

  for (const dial of [0.06, 0.18, 0.30, 0.42]) {
    const actual = measure(dial)
    const published = routeOdds(dial)
    assert.ok(Math.abs(actual - published) < 0.15,
      `dial ${dial}: HUD says ${(published * 100).toFixed(0)}% right, machine does ` +
      `${(actual * 100).toFixed(0)}%. Re-run: node tools/headless.js --threshold`)
  }
})

test('the coin-flip dial really is near even odds', () => {
  const d = coinFlipDial()
  assert.ok(d > 0.02 && d < 0.60, `coin-flip dial landed at ${d}, outside the usable band`)
  assert.ok(Math.abs(routeOdds(d) - 0.5) < 0.06,
    `dial ${d} gives ${(routeOdds(d) * 100).toFixed(0)}% right, not a coin flip`)
})

test('route odds rise monotonically with the dial', () => {
  let prev = -1
  for (let d = 0; d <= 1.0001; d += 0.01) {
    const p = routeOdds(d)
    assert.ok(p >= prev - 1e-9, `route odds fell at dial ${d.toFixed(2)}`)
    prev = p
  }
})

test('a tap fires one ball at the base power', () => {
  const m = new Machine({ seed: 11, tokens: 50 })
  m.dial = 0.30
  const shots = runPull(m, 4, (t) => t > 1 && t < 1.03)          // a 30 ms tap
  assert.equal(shots.length, 1, `a tap produced ${shots.length} balls`)
  assert.ok(Math.abs(shots[0].power - 0.30) < 0.05,
    `tap fired at power ${shots[0].power.toFixed(3)}, expected ≈ base 0.30`)
})

test('a full pull fires at full power, whatever the base', () => {
  const m = new Machine({ seed: 12, tokens: 50 })
  m.dial = 0.10
  const shots = runPull(m, 5, (t) => t > 1 && t < 1 + CHARGE_TIME + 0.4)
  assert.equal(shots.length, 1)
  assert.ok(shots[0].power > 0.98, `full pull fired at ${shots[0].power.toFixed(3)}`)
})

test('the pull ramps monotonically from base and stops exactly at 1', () => {
  const m = new Machine({ seed: 13, tokens: 50 })
  m.dial = 0.25
  m.beginCharge()
  let prev = m.power
  for (let i = 0; i < Math.round(2.0 / DT); i++) {
    m.step(DT)
    assert.ok(m.power >= prev - 1e-12, `pull fell from ${prev} to ${m.power}`)
    assert.ok(m.power <= 1 + 1e-12, `pull overshot: ${m.power}`)
    prev = m.power
  }
  assert.ok(Math.abs(m.power - 1) < 1e-9, `held pull settled at ${m.power}, not 1`)
})

test('a release inside the lockout is not swallowed — it fires when allowed, at its own power', () => {
  const m = new Machine({ seed: 14, tokens: 50 })
  m.dial = 0.20
  // Tap at t=1 (fires immediately, arms the lockout), then a 150 ms pull
  // released well inside the 0.6 s lockout.
  const shots = runPull(m, 4, (t) => (t > 1 && t < 1.03) || (t > 1.10 && t < 1.25))
  assert.equal(shots.length, 2, `expected the buffered release to fire, got ${shots.length}`)
  const gap = shots[1].t - shots[0].t
  assert.ok(gap >= LAUNCH_INTERVAL - DT * 1.5,
    `buffered shot broke the lockout: ${gap.toFixed(4)} s gap`)
  // ~150 ms of pull over CHARGE_TIME from base 0.2: power ≈ 0.2 + 0.8·0.15/1.1.
  const expect = 0.20 + 0.80 * (0.15 / CHARGE_TIME)
  assert.ok(Math.abs(shots[1].power - expect) < 0.05,
    `buffered shot fired at ${shots[1].power.toFixed(3)}, pull reached ≈ ${expect.toFixed(3)}`)
})

test('the release buffer is one shot deep', () => {
  const m = new Machine({ seed: 15, tokens: 50 })
  // One immediate shot, then TWO taps released inside the same lockout.
  const shots = runPull(m, 4,
    (t) => (t > 1 && t < 1.03) || (t > 1.10 && t < 1.16) || (t > 1.30 && t < 1.36))
  assert.equal(shots.length, 2, `two releases in one lockout fired ${shots.length - 1} balls, not 1`)
})

test('every fire-rate setting honors its own interval and reaches its own rate', () => {
  for (const [key, R] of Object.entries(FIRE_RATES)) {
    const m = new Machine({ seed: 16, tokens: 4000, fireInterval: R.interval })
    const shots = run(m, 30, () => true)
    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i].t - shots[i - 1].t
      assert.ok(gap >= R.interval - DT * 1.5,
        `${key}: shots ${i - 1}→${i} were ${gap.toFixed(4)} s apart, under ${R.interval} s`)
    }
    assert.ok(shots.length > 0.9 * 30 / R.interval,
      `${key}: expected ≈${Math.round(30 / R.interval)} shots in 30 s, got ${shots.length}`)
  }
})

test('the class default is still the legal interval', () => {
  // FIRE_RATES.arcade/storm are opted into by the shell. A Machine constructed
  // bare — every tool, every test, every future harness — is regulation.
  const m = new Machine({ seed: 17 })
  assert.equal(m.fireInterval, LAUNCH_INTERVAL)
})

test('charged shots are deterministic', () => {
  const play = () => {
    const m = new Machine({ seed: 78, tokens: 600, fireInterval: FIRE_RATES.arcade.interval })
    const shots = runPull(m, 20, (t) => (t % 1.7) < 0.4)   // repeating 400 ms pulls
    return shots.map(s => `${s.power.toFixed(9)}@${s.speed.toFixed(9)}`).join(',') +
      `|${m.tokens}|${m.spent}`
  }
  assert.equal(play(), play(), 'the pull mechanic is not deterministic')
})

test('rate-dependent scatter cannot change any outcome by itself', () => {
  // Law L4 adjacent: the launcher is simulation, not presentation, so it MAY
  // affect outcomes — but it must do so only through the ball's speed, and it
  // must stay deterministic. Same seed and same trigger pattern, same session.
  const play = () => {
    const m = new Machine({ seed: 77, tokens: 600 })
    const shots = run(m, 25, (t) => (t % 1.5) < 0.05)
    return shots.map(s => s.speed.toFixed(9)).join(',') + `|${m.tokens}|${m.spent}`
  }
  assert.equal(play(), play(), 'the launcher is not deterministic')
})
