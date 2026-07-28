// The model of the player.
//
// This file is the reason Pachinkode exists. Everything else simulates a machine;
// this simulates what the machine is *for*.
//
// Design law L2: the science must be a mechanism, not a mood. Every constant in
// here traces to a specific published finding, cited at the constant. Where the
// literature is contested, the contest is implemented rather than resolved
// (see RAMP below). Where a plausible design intuition turned out to be
// unsupported, it was cut rather than dressed up as science — see the note on
// pitch contour at the bottom.
//
// This module reads simulation events and produces numbers. It never writes back.
// Nothing here may change an outcome, an odds, or a payout: the renderer and the
// synth are its only consumers, and the VARNISH control scales their use of it.
// test/varnish.test.js enforces that.

/**
 * Cell size for the value map. The board is 440 × 490 mm, so 20 mm cells give a
 * 22 × 25 grid — coarse enough to learn from a few hundred balls, fine enough
 * that the funnel above the start pocket is its own cell.
 */
const CELL = 0.020

// ── Constants, with their provenance ────────────────────────────────────────

// Niv, Duff & Dayan (2005), Behavioral and Brain Functions 1:6, reporting the
// asymmetry in Schultz-lab recordings: positive prediction errors show as firing
// ~270% above baseline, negative errors as only ~55% below it. Baseline is a low
// 2–4 Hz, so the downside is clipped by the floor and the upside is not.
//
// The consequence is the entire trap, and it is two lines of code: a run of
// losses cannot arithmetically cancel a win in this channel. The machine is
// incapable of *feeling* net-negative even while it is taking your money. The
// honest ledger in the HUD exists because this is true.
const DA_UP = 2.70
const DA_DOWN = 0.55
const DA_BASE = 1.0

// Schultz (2010), Behavioral and Brain Functions 6:24: phasic activations have
// latencies under 100 ms and durations under 200 ms.
const PHASIC_RISE = 0.09   // s
const PHASIC_FALL = 0.20   // s

// Same source, on the delay-period signal: "Risk related activations have longer
// latencies (about 1 s), slower time courses and lower peaks compared to the
// reward value responses", and are seen in about one third of neurons.
const RAMP_LATENCY = 1.0   // s
const RAMP_WEIGHT = 0.33

// Learning rate for the value map. Not from the literature — a simulation knob.
const ALPHA = 0.14

export class Dopamine {
  constructor (boardW, boardH) {
    this.cols = Math.ceil(boardW / CELL)
    this.rows = Math.ceil(boardH / CELL)
    const n = this.cols * this.rows
    this.V = new Float32Array(n)        // learned expected return from this cell
    this.N = new Float32Array(n)        // visit counts
    this.M2 = new Float32Array(n)       // for outcome variance → uncertainty
    this.visits = new Map()             // ballId → Set of cell indices

    this.da = DA_BASE
    this.daTarget = DA_BASE
    this.delta = 0                      // the live RPE, for the flash
    this.arousal = 0
    this.valence = 0                    // pleasantness — moves opposite motivation on a near-miss
    this.motivation = 0
    this.ramp = 0
    this.rampT = -1
    this.rampU = 0
    this.impactRate = 0
    this.dry = 0                        // seconds since anything good happened

    // Diagnostics for tools/ramp-experiment.js — see RAMP note below.
    this.trace = null
  }

  idx (x, y) {
    const c = Math.min(this.cols - 1, Math.max(0, (x / CELL) | 0))
    const r = Math.min(this.rows - 1, Math.max(0, (y / CELL) | 0))
    return r * this.cols + c
  }

  /** Record that a ball passed through a cell. Called cheaply, once per frame. */
  visit (ball) {
    let s = this.visits.get(ball.id)
    if (!s) this.visits.set(ball.id, s = new Set())
    s.add(this.idx(ball.x, ball.y))
  }

  /**
   * A ball finished. Update every cell it touched toward the realised return.
   *
   * This is every-visit Monte Carlo with a constant step size — the delta rule
   * Glimcher (2011) restates as A_next = A_prev + α(R_current − A_prev), which is
   * the TD update with the episode's actual return standing in for the bootstrap.
   * Episodes here are seconds long and always terminate, so the full return is
   * available and there is nothing to gain from bootstrapping.
   *
   * The visible consequence is the nicest thing in the renderer: ball trails are
   * coloured by V, so at the start of a session the board is uniformly grey and
   * over a few hundred balls it *learns its own value landscape*. The bright
   * thread above the start pocket is not authored. It is discovered.
   */
  settle (ball, reward) {
    const s = this.visits.get(ball.id)
    this.visits.delete(ball.id)
    if (!s) return 0

    let predicted = 0
    for (const i of s) predicted += this.V[i]
    predicted /= s.size

    for (const i of s) {
      const err = reward - this.V[i]
      this.V[i] += ALPHA * err
      this.N[i]++
      this.M2[i] += (err * err - this.M2[i]) * 0.10
    }
    return reward - predicted
  }

  /** Expected return from a point, in tokens. Drives trail colour. */
  valueAt (x, y) { return this.V[this.idx(x, y)] }

  /** Confidence in that estimate, 0..1. Grey until the machine has seen enough. */
  confidenceAt (x, y) {
    const n = this.N[this.idx(x, y)]
    return n / (n + 12)
  }

  /**
   * Outcome uncertainty at a point, normalised 0..1.
   *
   * Fiorillo, Tobler & Schultz (2003) report a sustained ramp during the
   * cue–reward delay that is maximal at p = 0.5, i.e. tracks Bernoulli variance
   * p(1−p). Here the relevant uncertainty is not the spin's ~1/99 — that is
   * nearly certain, and nearly certain outcomes carry no ramp — but the *ball's*:
   * directly above the life nails a ball genuinely is near a coin flip, and that
   * is exactly the moment a real player leans in.
   *
   * So the uncertainty this machine ramps on is real uncertainty about a real
   * physical event, measured from its own outcome history.
   */
  uncertaintyAt (x, y) {
    const i = this.idx(x, y)
    if (this.N[i] < 4) return 0
    const sd = Math.sqrt(Math.max(0, this.M2[i]))
    return Math.min(1, sd / 8)
  }

  // ── event channel ────────────────────────────────────────────────────────

  /**
   * Feed a prediction error into the phasic channel, asymmetrically.
   * `d` is in tokens; SCALE turns it into something the renderer can use.
   */
  push (d) {
    const SCALE = 1 / 14           // one start-pocket entry ≈ one full unit
    const x = d * SCALE
    this.delta = x
    this.daTarget = DA_BASE + (x > 0 ? DA_UP * x : DA_DOWN * x)
    if (this.daTarget < 0) this.daTarget = 0      // firing rate has a floor
    this.arousal = Math.min(1, this.arousal + Math.abs(x) * 0.55)
    if (x > 0) { this.dry = 0; this.valence += x * 0.6; this.motivation += x * 0.5 }
  }

  /** A spin began. Start the anticipation ramp, scaled by how uncertain it is. */
  beginRamp (uncertainty) {
    this.rampT = 0
    this.rampU = uncertainty
  }

  endRamp () { this.rampT = -1 }

  /**
   * A near miss.
   *
   * Clark et al. (2009), Neuron 61(3): near-misses were rated significantly LESS
   * pleasant (t₃₉ = −2.75, p = .009) and significantly MORE motivating
   * (t₃₉ = +2.66, p = .011) than full misses. Valence and motivation come apart —
   * that dissociation is the finding, not a flourish.
   *
   * And it is gated on agency: the effect appeared only on trials the participant
   * chose (interaction F₂,₇₈ = 6.50, p = .002); computer-chosen near-misses
   * *reduced* the desire to play. So `chose` is a real parameter, not decoration.
   * In Pachinkode the player always chose — they set the dial that put the ball
   * in — which is precisely why a pachinko handle is worth having.
   *
   * The HUD shows valence and motivation as two separate needles so the player
   * can watch them diverge.
   */
  nearMiss (chose = true) {
    this.valence -= 0.28
    this.motivation += chose ? 0.34 : -0.20
    this.arousal = Math.min(1, this.arousal + 0.30)
  }

  update (dt, ctx = {}) {
    // Phasic channel: fast attack, fast decay, per Schultz's <100 ms / <200 ms.
    const k = this.da < this.daTarget ? dt / PHASIC_RISE : dt / PHASIC_FALL
    this.da += (this.daTarget - this.da) * Math.min(1, k)
    this.daTarget += (DA_BASE - this.daTarget) * Math.min(1, dt / PHASIC_FALL)
    this.delta *= Math.max(0, 1 - dt / 0.45)

    // Sustained ramp: later, slower, lower, and only as strong as the uncertainty.
    if (this.rampT >= 0) {
      this.rampT += dt
      const t = Math.max(0, this.rampT - RAMP_LATENCY)
      this.ramp = RAMP_WEIGHT * this.rampU * (1 - Math.exp(-t / 1.4))
    } else {
      this.ramp += (0 - this.ramp) * Math.min(1, dt * 3)
    }

    // Arousal: a leaky integrator over everything happening at once. The impact
    // rate matters — a board with twenty balls raining on brass is arousing on
    // its own, independent of whether any of them pay.
    const traffic = Math.min(1, (ctx.balls || 0) / 14)
    const rain = Math.min(1, (ctx.impacts || 0) / 90)
    this.impactRate += (rain - this.impactRate) * Math.min(1, dt * 4)
    const drive = 0.45 * this.impactRate + 0.30 * traffic + this.ramp
    this.arousal += (drive - this.arousal) * Math.min(1, dt * (drive > this.arousal ? 1.8 : 0.5))
    this.arousal = Math.max(0, Math.min(1, this.arousal))

    this.valence += (0 - this.valence) * Math.min(1, dt * 0.5)
    this.motivation += (0 - this.motivation) * Math.min(1, dt * 0.28)
    this.valence = Math.max(-1, Math.min(1, this.valence))
    this.motivation = Math.max(-1, Math.min(1, this.motivation))
    this.dry += dt

    if (this.trace) this.trace.push({ t: ctx.t || 0, da: this.da, ramp: this.ramp })
  }

  /**
   * Extinction: how long since anything good happened, 0..1.
   * Drives the board's visible sag. Ferster & Skinner (1957) is the schedule
   * literature; the specific curve here is a simulation choice, not a citation.
   */
  get extinction () { return Math.min(1, this.dry / 45) }
}

// ── RAMP: an argument, left open on purpose ─────────────────────────────────
//
// Whether the delay-period ramp reflects genuine uncertainty coding is unsettled,
// and the disagreement was published back-to-back in the same journal:
//
//   Fiorillo, Tobler & Schultz (2005), BBF 1:7 — the activation is sustained
//   within single trials, and TD models are constitutionally blind to risk: they
//   "do not discriminate amongst" a 10% chance of $100 and a 100% chance of $10.
//
//   Niv, Duff & Dayan (2005), BBF 1:6 — the ramp may be an averaging artifact.
//   Because negative errors are clipped at a floor 55% below baseline while
//   positive errors reach 270% above it, averaging back-propagating TD errors
//   over trials produces an apparent smooth ramp, largest at p = 0.5, with no
//   uncertainty term anywhere in the model.
//
// This file implements BOTH and does not adjudicate. `ramp` is Fiorillo's
// explicit term. `da` is the plain asymmetric TD channel, which under Niv's
// account should grow a ramp *by itself* when averaged across trials — and
// tools/ramp-experiment.js runs exactly that average and prints the result.
//
// So the game ships with the experiment attached. A player can run it and see
// whether this machine's own data grows the ramp without being told to.
//
// ── one cut ─────────────────────────────────────────────────────────────────
//
// An earlier draft pitched the nail-impact sounds upward as anticipation built,
// on the reasoning that rising pitch reads as approach-to-reward. A literature
// pass could not find a single peer-reviewed manipulation of pitch contour in a
// gambling context — it is design folklore repeated confidently. What IS
// established (Dixon et al. 2013, J. Gambling Studies, n=96) is narrower: audio
// must be win-paired, predictable, scaled in salience with reward size, and
// longer for bigger wins. The synth follows that and nothing more. The rising
// scale would have sounded good, and would have been a mood wearing a lab coat.
