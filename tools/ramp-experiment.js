// Run the Fiorillo / Niv argument, properly, on this machine.
//
//   node tools/ramp-experiment.js [--trials 4000]
//
// ── THE ARGUMENT ────────────────────────────────────────────────────────────
//
// Fiorillo, Tobler & Schultz (2003, Science 299) found that dopamine neurons show
// a sustained ramp during the delay between a reward cue and its outcome, and
// that the ramp is largest when the outcome is maximally uncertain — an inverted
// U peaking at p = 0.5. Two readings were published back-to-back in Behavioral
// and Brain Functions in 2005:
//
//   Fiorillo, Tobler & Schultz (1:7) — it is a genuine uncertainty signal.
//     Temporal-difference models are constitutionally blind to risk: they "do not
//     discriminate amongst" a 10% chance of $100 and a 100% chance of $10.
//
//   Niv, Duff & Dayan (1:6) — it is an averaging artifact. Positive prediction
//     errors fire ~270% above baseline while negative errors are clipped at only
//     ~55% below it. Average back-propagating TD errors ACROSS TRIALS under that
//     asymmetry and a smooth ramp appears, largest at p = 0.5, with no
//     uncertainty term anywhere in the model.
//
// ── WHY THE FIRST VERSION OF THIS TOOL WAS WRONG ────────────────────────────
//
// It drove the game's own `Dopamine.da` channel and found no ramp. That was a
// null result for a bad reason: `dopamine.js` updates only on events, so it has
// no within-trial temporal representation — and back-propagation through time is
// precisely the mechanism Niv's artifact needs. The test could not detect the
// thing it was testing.
//
// So this file implements Niv's actual setup: a tapped delay line of states from
// cue to outcome, plain TD(0), no uncertainty term of any kind, read out through
// the measured firing asymmetry. That is the model Niv says suffices. If a ramp
// appears in it, it appeared without anyone asking for one.
//
// The game's dopamine.js keeps Fiorillo's explicit term for rendering, because a
// renderer needs a number now, not after four thousand trials. The two live side
// by side on purpose. See docs/SCIENCE.md §2.

import { SPECS } from '../src/sim/machine.js'

const args = { trials: 4000, bins: 20, seed: 11 }
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = isNaN(+process.argv[i + 1]) ? process.argv[++i] : +process.argv[++i]
}

// Measured firing asymmetry — Niv, Duff & Dayan (2005), reporting Schultz-lab data.
const K_UP = 2.70
const K_DOWN = 0.55
const BASE = 1.0

const ALPHA = 0.02
const GAMMA = 0.97

// Deterministic PRNG so the experiment replays.
function rng (seed) {
  let s = seed >>> 0
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

/**
 * Niv's model, exactly: a tapped delay line from cue to reward, TD(0), and a
 * readout that clips negative errors the way real dopamine neurons do.
 *
 * `asymmetric = false` gives the control — same learning, symmetric readout.
 * If the ramp is an averaging artifact of the clipping, it must vanish here.
 */
function experiment (p, { trials, bins, asymmetric, seed }) {
  const rand = rng(seed)
  const V = new Float64Array(bins + 1)
  const sum = new Float64Array(bins)
  const count = new Float64Array(bins)
  // Discard a burn-in so we average the learned steady state, not the learning.
  const burn = Math.floor(trials * 0.35)

  for (let trial = 0; trial < trials; trial++) {
    const rewarded = rand() < p
    for (let t = 0; t < bins; t++) {
      const last = t === bins - 1
      const r = last ? (rewarded ? 1 : 0) : 0
      const vNext = last ? 0 : V[t + 1]
      const delta = r + GAMMA * vNext - V[t]
      V[t] += ALPHA * delta

      let da = asymmetric
        ? BASE + (delta > 0 ? K_UP * delta : K_DOWN * delta)
        : BASE + K_UP * delta
      if (da < 0) da = 0                       // firing rate has a floor
      if (trial >= burn) { sum[t] += da; count[t]++ }
    }
  }
  const trace = Array.from(sum, (v, i) => (count[i] ? v / count[i] : 0))
  return { trace, V: Array.from(V) }
}

/** Least-squares slope across the delay, excluding the outcome bin itself. */
function slope (ys) {
  const y = ys.slice(0, ys.length - 1)
  const n = y.length
  const mx = (n - 1) / 2
  const my = y.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (i - mx) * (y[i] - my); den += (i - mx) ** 2 }
  return num / den
}

function spark (ys) {
  const body = ys.slice(0, ys.length - 1)
  const lo = Math.min(...body), hi = Math.max(...body)
  const g = '▁▂▃▄▅▆▇█'
  const span = (hi - lo) || 1
  return body.map(v => g[Math.min(7, Math.floor(((v - lo) / span) * 7.999))]).join('')
}

console.log(`\n  PACHINKODE — the Fiorillo / Niv ramp experiment`)
console.log(`  ${args.trials} trials per condition, ${args.bins}-step delay line`)
console.log(`  Plain TD(0). No uncertainty term exists anywhere in this model.\n`)

const PS = [0, 0.25, 0.5, 0.75, 1]
const rows = []

console.log('  ASYMMETRIC readout  (positive errors ×2.70, negative ×0.55 — the measured ratio)')
console.log('   ' + '─'.repeat(66))
console.log('     p     delay-period activity            slope      mean')
for (const p of PS) {
  const { trace } = experiment(p, { ...args, asymmetric: true })
  const s = slope(trace)
  const mean = trace.slice(0, -1).reduce((a, b) => a + b, 0) / (trace.length - 1)
  rows.push({ p, slope: s, mean })
  console.log(`   ${p.toFixed(2)}   ${spark(trace)}   ${s >= 0 ? '+' : ''}${s.toFixed(5)}   ${mean.toFixed(4)}`)
}

console.log('\n  SYMMETRIC control  (both directions ×2.70 — the clipping removed)')
console.log('   ' + '─'.repeat(66))
const ctrl = []
for (const p of PS) {
  const { trace } = experiment(p, { ...args, asymmetric: false })
  const s = slope(trace)
  ctrl.push({ p, slope: s })
  console.log(`   ${p.toFixed(2)}   ${spark(trace)}   ${s >= 0 ? '+' : ''}${s.toFixed(5)}`)
}

// The signature Fiorillo reported is an INVERTED U in p: no ramp at certainty,
// maximum at p = 0.5.
const half = rows.find(r => r.p === 0.5)
const ends = [rows.find(r => r.p === 0), rows.find(r => r.p === 1)]
const endMax = Math.max(...ends.map(e => Math.abs(e.slope)))
const ctrlHalf = ctrl.find(r => r.p === 0.5)

console.log('\n  ' + '═'.repeat(66))
console.log(`  ramp slope at p = 0.5, asymmetric : ${half.slope >= 0 ? '+' : ''}${half.slope.toFixed(5)}`)
console.log(`  ramp slope at p = 0 and p = 1     : ${ends.map(e => e.slope.toFixed(5)).join('  ')}`)
console.log(`  ramp slope at p = 0.5, symmetric  : ${ctrlHalf.slope >= 0 ? '+' : ''}${ctrlHalf.slope.toFixed(5)}`)

const invertedU = half.slope > 0 && half.slope > endMax * 3
const killedByControl = Math.abs(ctrlHalf.slope) < Math.abs(half.slope) / 3

console.log()
if (invertedU && killedByControl) {
  console.log('  A ramp appeared, peaked at maximum uncertainty, and vanished when the')
  console.log('  firing asymmetry was removed — in a model with no uncertainty term.')
  console.log('  On this data that is the Niv, Duff & Dayan (2005) account: the shape is')
  console.log('  an artifact of averaging clipped negative errors against unclipped')
  console.log('  positive ones. Nobody put an inverted U in. It fell out of the clipping.')
} else if (invertedU) {
  console.log('  A ramp appeared and peaked at maximum uncertainty, but survived the')
  console.log('  symmetric control — so on this data the clipping is not the whole story.')
} else {
  console.log('  No inverted-U ramp emerged from the bare TD model here, which is the')
  console.log('  Fiorillo, Tobler & Schultz (2005) position: TD alone does not produce it.')
}

// ── and the reason it matters for THIS machine ─────────────────────────────
const S = SPECS.amadeji
const pSpin = 1 / S.jackpotOdds
const nearest = PS.reduce((a, b) => Math.abs(b - pSpin) < Math.abs(a - pSpin) ? b : a)
console.log('\n  ' + '─'.repeat(66))
console.log(`  Now the part that matters for pachinko.`)
console.log()
console.log(`  This machine's spin wins with p = 1/${S.jackpotOdds} = ${pSpin.toFixed(4)}.`)
console.log(`  That sits at the FLAT end of the curve above (nearest sampled p = ${nearest}),`)
console.log(`  where uncertainty is near zero and there is nothing to ramp on.`)
console.log()
console.log(`  Which is the whole design of the game. The spin carries almost no`)
console.log(`  uncertainty — it is a near-certain loss dressed as a contest. The real`)
console.log(`  uncertainty is in the BALL: directly above the life nails, with 0.75 mm`)
console.log(`  of clearance per side, a ball genuinely is near a coin flip. That is what`)
console.log(`  Dopamine.uncertaintyAt() measures, and it is why the anticipation in this`)
console.log(`  machine is attached to steel falling through brass rather than to reels.`)
console.log()
console.log(`  Neither result settles the neuroscience. The point is that the question is`)
console.log(`  askable inside a video game, and that you did not have to take the source`)
console.log(`  code's word for it.\n`)
