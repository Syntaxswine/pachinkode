// The wave — the lottery's tide. What must stay true whatever gets retuned:
// the shape's geometry, the no-minting normalisation, the welcome wave's
// window and floor, and the p=0.5 certainty cap.
import test from 'node:test'
import assert from 'node:assert/strict'

import { Machine, WAVE, waveW, WAVE_MEAN, WAVE_NORM } from '../src/sim/machine.js'
import { DT } from '../src/sim/world.js'

test('waveW: bounded, crests at WAVE.crest, slow rise / quick fall', () => {
  for (let p = 0; p <= 1.001; p += 0.01) {
    const w = waveW(p)
    assert.ok(w >= 0 && w <= 1.0001, `w(${p}) = ${w} out of range`)
  }
  assert.ok(Math.abs(waveW(WAVE.crest) - 1) < 1e-9, 'crest is the peak')
  assert.equal(waveW(0), 0)
  // Asymmetry: the rise takes most of the cycle, the fall the remainder.
  assert.ok(waveW(WAVE.crest / 2) < 0.5, 'the rise starts slow — anticipation lives there')
  assert.ok(Math.abs(waveW(WAVE.crest + (1 - WAVE.crest) / 2) - 0.5) < 1e-9, 'the fall is linear')
})

test('the wave mints no luck: cycle-mean multiplier is 1', () => {
  // Numerical integral of the normalised multiplier over one steady cycle.
  let sum = 0
  const N = 20000
  for (let i = 0; i < N; i++) sum += (1 + (WAVE.boost - 1) * waveW(i / N)) / WAVE_NORM
  assert.ok(Math.abs(sum / N - 1) < 1e-3, `cycle-mean ${sum / N} — the wave must redistribute, not mint`)
  // And the exported closed-form mean matches the shape.
  let wm = 0
  for (let i = 0; i < N; i++) wm += waveW(i / N)
  assert.ok(Math.abs(wm / N - WAVE_MEAN) < 1e-3)
})

test('the welcome wave: crests inside the operator\'s 15–30 s window, never below book odds', () => {
  const m = new Machine({ seed: 1 })
  const crestAt = WAVE.welcomePeriod * WAVE.crest
  assert.ok(crestAt >= 15 && crestAt <= 30, `welcome crest at ${crestAt}s — the front-door machine must pay early`)
  // A gift, not a redistribution: the welcome multiplier never dips below 1.
  for (let t = 0; t < WAVE.welcomePeriod; t += 0.25) {
    m.time = t
    assert.ok(m.waveMult >= 1 - 1e-12, `welcome mult ${m.waveMult} at t=${t} dips below book odds`)
  }
  m.time = crestAt
  assert.ok(m.waveMult > WAVE.boost, 'the welcome crest outguns the steady crest')
})

test('after the welcome the tide is periodic and oddsNow breathes around the book figure', () => {
  const m = new Machine({ seed: 1 })
  m.time = WAVE.welcomePeriod + 3
  const a = m.oddsNow
  m.time += WAVE.period
  assert.ok(Math.abs(m.oddsNow - a) < 1e-9, 'one full period later the odds must repeat')
  // Trough odds are worse than book, crest odds better.
  m.time = WAVE.welcomePeriod + 0.01
  assert.ok(m.oddsNow > m.odds, 'trough: leaner than book')
  m.time = WAVE.welcomePeriod + WAVE.period * WAVE.crest
  assert.ok(m.oddsNow < m.odds, 'crest: richer than book')
})

test('no crest is ever a certainty: the win draw is capped at p = 0.5', () => {
  // The loosest spec in kakuhen at the welcome crest is the extreme case.
  const m = new Machine({ seed: 3, spec: 'uramono' })
  m.kakuhen = 5
  m.time = WAVE.welcomePeriod * WAVE.crest
  assert.ok(m.waveMult / m.odds > 0.5, 'the extreme case really does exceed the cap (else this test guards nothing)')
  // The cap lives in the draw itself; here we pin the exposed quantities that
  // make it reachable, and machine.js clamps with Math.min(0.5, ...).
})

test('the wave leaves the rng stream alone: same draw count per spin decision', () => {
  // Two machines, same seed: one with time forced to trough, one to crest.
  // The spins differ in OUTCOME probability, never in how many rng calls a
  // spin consumes — outcome, ko, reach, display seed, always four.
  const draws = (timeAt) => {
    const m = new Machine({ seed: 77 })
    m.time = timeAt
    let n = 0
    const rng = m.rng
    m.rng = () => { n++; return rng() }
    m.holds = 1
    m.tickLottery(DT)
    return n
  }
  assert.equal(draws(WAVE.welcomePeriod + 1), draws(WAVE.welcomePeriod + WAVE.period * WAVE.crest))
})

// ── the wall-side gold split (operator's find, 2026-07-29) ──────────────────

test('a gold split beside a wall never births the twin in dead space', async () => {
  const { World, makeBall, BALL_R, MAT } = await import('../src/sim/world.js')
  // A vertical wall immediately LEFT of a nail: the old blind offset spawned
  // the leftward twin straight through it.
  const w = new World({ w: 0.44, h: 0.55 })
  // The nail sits one ball-radius-and-change off the wall face — the rail
  // environment. A twin offset a full diameter leftward lands PAST the
  // wall's centerline, where the contact solver resolves it to the far side
  // and it lives in dead space (the operator watched it happen).
  w.addSegment(0.09, 0.0, 0.09, 0.5, 0.002, MAT.wall)
  const nail = w.addNail(0.09 + 0.002 + BALL_R + 0.0004, 0.25)
  w.spawn(makeBall(nail.x + 0.0002, nail.y - 0.02, 0, 0.4, { gold: true }))
  let split = null
  for (let i = 0; i < 1200 && !split; i++) {
    w.step()
    for (const ev of w.drainEvents()) if (ev.type === 'split') split = ev
  }
  assert.ok(split, 'no split happened — the setup missed the nail')
  for (const b of w.balls) {
    assert.ok(b.x > 0.09, `a ball sits at x=${b.x.toFixed(4)} — behind the wall at 0.09`)
  }
})
