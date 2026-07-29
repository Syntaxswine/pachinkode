// Probe: hard invariants, checked while the machine actually runs.
//
// This probe exists because of the negative-dt bug (HANDOFF, "Two late
// additions"): a clock step made dt negative, the sim integrated backwards,
// and the SYMPTOM — a 75% foul rate — matched the channel jam so well it hid
// for minutes. The number that named it instantly was an invariant, violated:
// `sinceLaunch = −2.383 s`. Statistics tell stories; invariants tell truths.
// When any other probe flags something, read this line first.
//
// What is pinned here, every step or every few steps of a live driven run:
//
//   sinceLaunch ≥ 0                       — the bug's own signature
//   every ball's state finite             — NaN is a fire alarm, not a datum
//   ledger conservation:
//     tokens === conjured + won + bought − spent
//                                         — every token path (launch, pay,
//                                           foul refund, channel-stuck refund,
//                                           purchase, conjure) balances
//   ledger counters are non-negative integers
//   rtp === won / spent                   — the derived figure derives
//
// And, driven separately on a Run with fuzzed scoring:
//
//   base + fromChain === score + spent    — the keystone's amended identity
//   sum(bySource) === sum(byOrigin) === score + spent
export default {
  name: 'invariants',
  why: 'hard invariants on a live run — the negative-dt lesson made standing',
  async run ({ depth }) {
    const { Machine } = await import('../../../src/sim/machine.js')
    const { DT } = await import('../../../src/sim/world.js')
    const { Run, sandboxCabinet, SCORE } = await import('../../../src/sim/run.js')

    const anomalies = []
    const balls = depth === 'quick' ? 400 : 1500
    const seeds = depth === 'quick' ? [11, 202] : [11, 202, 3003, 40004]

    let steps = 0
    for (const seed of seeds) {
      const m = new Machine({ seed, tokens: balls + 10, fireInterval: 0.2 })
      m.dial = 0.2
      m.firing = true
      let guard = 0
      let worst = 0
      while (guard < balls * 30000) {
        guard++
        steps++
        if (m.launched >= balls) m.firing = false
        m.step(DT)
        m.drain()
        if (m.sinceLaunch < worst) worst = m.sinceLaunch
        if (guard % 7 === 0) {
          // Ledger conservation — cheap enough to check nearly every step.
          if (m.tokens !== m.conjured + m.won + m.bought - m.spent) {
            anomalies.push(`seed ${seed}: ledger broke conservation at step ${guard}: tokens ${m.tokens} ≠ conjured ${m.conjured} + won ${m.won} + bought ${m.bought} − spent ${m.spent}`)
            break
          }
        }
        if (guard % 97 === 0) {
          for (const b of m.world.balls) {
            if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) {
              anomalies.push(`seed ${seed}: non-finite ball state at step ${guard}`)
              guard = Infinity
              break
            }
          }
        }
        if (!m.firing && m.world.balls.length === 0 && m.launched >= balls) break
      }
      if (worst < 0) anomalies.push(`seed ${seed}: sinceLaunch went NEGATIVE (${worst.toFixed(3)} s) — the trapped builder's bug is back`)
      for (const k of ['spent', 'won', 'conjured', 'bought']) {
        if (!Number.isInteger(m[k]) || m[k] < 0) anomalies.push(`seed ${seed}: ledger counter ${k} = ${m[k]} is not a non-negative integer`)
      }
      if (m.spent > 0 && Math.abs(m.rtp - m.won / m.spent) > 1e-12) {
        anomalies.push(`seed ${seed}: rtp ${m.rtp} does not derive from won/spent`)
      }
    }

    // The keystone's amended identity, fuzzed. Deterministic seeds: the canary
    // hunts regressions, not RNG holes.
    const kinds = Object.keys(SCORE)
    for (const seed of [5, 77]) {
      const run = new Run(sandboxCabinet('amadeji'), seed)
      let s = seed
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
      for (let i = 0; i < 800; i++) {
        run.add(SCORE[kinds[(rnd() * kinds.length) | 0]], kinds[(rnd() * kinds.length) | 0])
        if (rnd() < 0.05 && run.score > 200) run.spendScore(100 + ((rnd() * run.score * 0.5) | 0))
        run.observe([], rnd() * 0.8)
      }
      const P = run.provenance
      const bySource = Object.values(P.bySource).reduce((a, b) => a + b, 0)
      const byOrigin = Object.values(P.byOrigin).reduce((a, b) => a + b, 0)
      const rhs = run.score + run.spent
      if (P.base + P.fromChain !== rhs) anomalies.push(`provenance seed ${seed}: base+fromChain ${P.base + P.fromChain} ≠ score+spent ${rhs}`)
      if (bySource !== rhs || byOrigin !== rhs) anomalies.push(`provenance seed ${seed}: bySource ${bySource} / byOrigin ${byOrigin} ≠ score+spent ${rhs}`)
    }

    return {
      summary: anomalies.length ? 'INVARIANT VIOLATED' : `held across ${seeds.length} machine seeds (${steps.toLocaleString()} steps) + 2 fuzzed runs`,
      metrics: { seeds: seeds.length, steps },
      anomalies
    }
  }
}
