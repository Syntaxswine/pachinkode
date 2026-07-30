// TEMPER — the work-hardening ladder. The paddles are the mint (operator's
// design): windmill vane strikes and the TEMPER BAR promote a ball's value
// tier, and the tier multiplies what the ball's pockets SCORE — never what
// they pay in balls. These tests pin the laws, not the balance.
import test from 'node:test'
import assert from 'node:assert'
import { Machine, TEMPER_STEP, TEMPER_MAX } from '../src/sim/machine.js'
import { makeBall } from '../src/sim/world.js'
import { Run, SCORE } from '../src/sim/run.js'
import { resolveLoadout } from '../src/sim/loadout.js'

const cab = { key: 't', label: 't', spec: 'amadeji', difficulty: 1, parts: [] }

test('a vane strike tempers the ball once per rotor, capped at TEMPER_MAX', () => {
  const m = new Machine({ seed: 7 })
  const b = makeBall(0.2, 0.2)
  m._temper(b, 1 << 0, 'rotor', b.x, b.y)
  assert.equal(b.temper, 1)
  m._temper(b, 1 << 0, 'rotor', b.x, b.y)
  assert.equal(b.temper, 1, 'the same rotor minted the same ball twice')
  m._temper(b, 1 << 1, 'rotor', b.x, b.y)
  assert.equal(b.temper, 2, 'a different rotor must mint again')
  m._temper(b, 1 << 2, 'rotor', b.x, b.y)
  m._temper(b, 1 << 3, 'rotor', b.x, b.y)
  assert.equal(b.temper, TEMPER_MAX, 'the ladder must cap')
  const tempers = m.drain().filter(e => e.type === 'temper')
  assert.equal(tempers.length, TEMPER_MAX, 'every real promotion emits, and only real ones')
  assert.deepEqual(tempers.map(e => e.tier), [1, 2, 3], 'tiers announce in order')
})

test('the temper bar sweeps on machine time and promotes a passing ball once', () => {
  const L = resolveLoadout(['temperbar'])
  const m = new Machine({ seed: 7, loadout: L })
  assert.ok(m.temperBar, 'the part must build the bar')
  const B = m.temperBar
  // Park a ball dead on the bar's current x and band.
  const b = makeBall(m.temperBarX, B.y)
  m.world.balls.push(b)
  m.tickTemperBar()
  assert.equal(b.temper, 1, 'a ball in the band must be promoted')
  m.tickTemperBar()
  assert.equal(b.temper, 1, 'the bar promotes a ball once, ever')
  // The sweep is a triangle wave: half a period later it is at the far end.
  const x0 = m.temperBarX
  m.time += B.period / 2
  assert.ok(Math.abs(m.temperBarX - x0) > 0.1, 'the bar must actually travel')
  // Stock machines carry no bar.
  assert.equal(new Machine({ seed: 7 }).temperBar, null)
})

test('temper multiplies SCORE in the run — never the ball payout', () => {
  const run = new Run(cab)
  const flat = run.add(SCORE.bucket, 'bucket')
  const run2 = new Run(cab)
  run2.observe([{ type: 'bucket', value: 1, temper: 2, x: 0, y: 0, site: 's' }], 0.001, {})
  const tempered = run2.score
  assert.equal(tempered, Math.round(flat * Math.pow(TEMPER_STEP, 2)) ||
    tempered, 'sanity')
  // Same chain state (first event each), so the ratio is exactly STEP².
  assert.ok(Math.abs(tempered / flat - Math.pow(TEMPER_STEP, 2)) < 0.01,
    `a temper-2 bucket must score ×${TEMPER_STEP ** 2}: ${tempered} vs flat ${flat}`)
})

test('temper rides the warp and the gold split — same steel, same trip', () => {
  const m = new Machine({ seed: 7 })
  const b = makeBall(0.2, 0.1, 0, 0, { temper: 2, temperFrom: 3, gold: false })
  m.onPocket({ kind: 'warp', x: 0.2, y: 0.1, ball: b })
  const out = m.world.balls[m.world.balls.length - 1]
  assert.equal(out.temper, 2, 'the warp dropped the temper')
  assert.equal(out.temperFrom, 3, 'the warp dropped the once-per-rotor mask')
})

test('fitting the temper bar changes no trajectory — the bar is not solid', () => {
  // Same seed, same firing, with and without the bar: every ball position
  // must match to the bit. The bar transforms what pockets are WORTH; it
  // must never move a ball.
  const play = (loadout) => {
    const m = new Machine({ seed: 11, tokens: 60, loadout })
    m.dial = 0.24
    m.firing = true
    const snaps = []
    for (let i = 0; i < 4000; i++) {
      m.step(1 / 120)
      if (i % 500 === 0) snaps.push(m.world.balls.map(b => `${b.x.toFixed(12)},${b.y.toFixed(12)}`).join(';'))
    }
    return snaps.join('|')
  }
  assert.equal(play(resolveLoadout(['temperbar'])), play(resolveLoadout([])),
    'the temper bar moved a ball')
})
