// Procedural audio. No sample assets — every sound here is built from
// oscillators, a noise buffer, and filters, so the whole game is a few tens of
// kilobytes and hosts anywhere.
//
// What the literature actually supports about gambling audio is narrower than
// the folklore, and the synth sticks to it. Dixon et al. (2013), Journal of
// Gambling Studies, n=96, within-subject sound-on/sound-off: win-paired audio
// raised skin-conductance response (F(1,84) = 4.597, p = .035) and inflated the
// number of wins players *believed* they had from +15% to +24%
// (F(1,88) = 5.600, p = .020). Their machines used jingles from 1.5 s to 12 s,
// "the bigger the win the longer the song."
//
// So: win-paired, and duration proportional to magnitude. That is the whole
// verified toolkit and it is what is implemented. ("Predictable" and "salience
// scaled with size" stood here in an earlier draft and are not in that paper
// either — Dixon's team used unfamiliar custom sounds, which cuts against
// predictability, and salience was never manipulated. See the closing note in
// src/sim/dopamine.js.)
//
// The thing deliberately NOT implemented is an ascending pitch contour with
// rising anticipation. It is repeated confidently in design writing and has no
// peer-reviewed backing in a gambling context. It would have sounded great.
// See the closing note in src/sim/dopamine.js.

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)

// Shepard glissando geometry, kept as a pure function so the illusion can be
// verified in Node without a WebAudio context. See Synth.shepard() for what it
// is and why it is here, and test/shepard.test.js for the property it must hold.
export const SHEPARD = { span: 6, fTop: 1760, voices: 6 }

/**
 * The partials present at time `t`: their frequencies and gains.
 * Six sines an octave apart, sliding down under a spectral envelope that is a
 * fixed function of frequency — which is precisely why the ensemble sounds
 * stationary while every component of it is falling.
 */
export function shepardFrame (t, cycle = 6.4, S = SHEPARD) {
  const out = []
  for (let i = 0; i < S.voices; i++) {
    const p = (((t / cycle) + i / S.voices) % 1 + 1) % 1
    out.push({
      f: S.fTop * Math.pow(2, -S.span * p),
      g: 0.5 * (1 - Math.cos(2 * Math.PI * p))
    })
  }
  return out
}

export class Synth {
  constructor () {
    this.ctx = null
    this.ready = false
    this.vol = { master: 0.7, impacts: 0.55, rewards: 0.8, bed: 0.35 }
    this.muted = false
    this._budget = 0
    this._slot = 0
    this._frameT0 = 0
  }

  /** Must be called from a user gesture; browsers will not start audio otherwise. */
  async start () {
    if (this.ready) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return
    const ctx = this.ctx = new AC()

    this.master = ctx.createGain()
    this.master.gain.value = this.vol.master
    // A compressor doing limiter duty, so a jackpot with forty balls landing at
    // once will not clip in steady state. It is not a brickwall — with a 30 dB
    // soft knee and a 3 ms attack a very fast transient can still overshoot.
    this.comp = ctx.createDynamicsCompressor()
    this.comp.threshold.value = -14
    this.comp.ratio.value = 8
    this.comp.attack.value = 0.003
    this.comp.release.value = 0.18
    this.master.connect(this.comp).connect(ctx.destination)

    this.busImpacts = ctx.createGain(); this.busImpacts.gain.value = this.vol.impacts
    this.busRewards = ctx.createGain(); this.busRewards.gain.value = this.vol.rewards
    this.busBed = ctx.createGain(); this.busBed.gain.value = this.vol.bed
    for (const b of [this.busImpacts, this.busRewards, this.busBed]) b.connect(this.master)

    // One noise buffer, reused. Building it per-impact would be absurd at the
    // hundred-strikes-a-second a busy board produces.
    const n = ctx.sampleRate * 0.5
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let seed = 12345
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      d[i] = (seed / 2147483648) - 1
    }
    this.noise = buf

    this.buildBed()
    this.buildRain()
    this.ready = true
  }

  setVolumes (v) {
    Object.assign(this.vol, v)
    if (!this.ready) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.02)
    this.busImpacts.gain.setTargetAtTime(this.vol.impacts, t, 0.02)
    this.busRewards.gain.setTargetAtTime(this.vol.rewards, t, 0.02)
    this.busBed.gain.setTargetAtTime(this.vol.bed, t, 0.02)
  }

  setMuted (m) { this.muted = m; this.setVolumes({}) }

  // ── the bed ──────────────────────────────────────────────────────────────

  /**
   * A two-oscillator drone whose detuning tracks outcome uncertainty.
   *
   * At certainty the pair is in unison and the bed is still. At maximum
   * uncertainty they part and the sum beats against itself — the acoustic
   * signature of not knowing. Fiorillo's inverted-U made audible, and no
   * pitch-contour folklore required.
   */
  buildBed () {
    const ctx = this.ctx
    this.bedA = ctx.createOscillator(); this.bedA.type = 'sine'; this.bedA.frequency.value = 55
    this.bedB = ctx.createOscillator(); this.bedB.type = 'sine'; this.bedB.frequency.value = 55
    this.bedC = ctx.createOscillator(); this.bedC.type = 'triangle'; this.bedC.frequency.value = 110
    this.bedGain = ctx.createGain(); this.bedGain.gain.value = 0.0
    this.bedFilt = ctx.createBiquadFilter()
    this.bedFilt.type = 'lowpass'
    this.bedFilt.frequency.value = 300
    const cg = ctx.createGain(); cg.gain.value = 0.18
    this.bedA.connect(this.bedGain); this.bedB.connect(this.bedGain)
    this.bedC.connect(cg).connect(this.bedGain)
    this.bedGain.connect(this.bedFilt).connect(this.busBed)
    this.bedA.start(); this.bedB.start(); this.bedC.start()
  }

  /**
   * The brass rain, beyond the budget.
   *
   * Seven discrete voices cannot be three hundred strikes a second, however
   * honestly they are picked. This layer is a continuous noise bed through two
   * brass-register bandpasses whose gain follows the MEASURED impact rate —
   * counted events per second, handed in by the shell — so ten times the balls
   * genuinely sounds like ten times the rain, at constant cost. It is a
   * measurement made audible, not a mood.
   */
  buildRain () {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    this.rainGain = ctx.createGain()
    this.rainGain.gain.value = 0
    for (const [f, q] of [[2200, 1.5], [3600, 2]]) {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q
      src.connect(bp).connect(this.rainGain)
    }
    this.rainGain.connect(this.busImpacts)
    src.start()
  }

  /** `rate` is impacts per second, measured by counting, not estimated. */
  updateRain (rate, varnish) {
    if (!this.ready) return
    const v = clamp(varnish)
    const g = Math.min(0.11, 0.05 * Math.pow(Math.max(0, rate) / 90, 1.5)) * (0.45 + 0.55 * v)
    this.rainGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.12)
  }

  /** Called every frame. `varnish` scales the whole expressive layer. */
  updateBed (uncertainty, arousal, varnish) {
    if (!this.ready) return
    const t = this.ctx.currentTime
    const v = clamp(varnish)
    // At varnish 0 the bed collapses to a single dead tone: no beating, no lift.
    const detune = 0.8 + 7.0 * clamp(uncertainty) * v
    this.bedB.frequency.setTargetAtTime(55 + detune, t, 0.15)
    this.bedC.frequency.setTargetAtTime(110 + detune * 1.5, t, 0.15)
    this.bedGain.gain.setTargetAtTime(0.16 + 0.18 * arousal * v, t, 0.25)
    this.bedFilt.frequency.setTargetAtTime(220 + 900 * arousal * v, t, 0.30)
  }

  // ── impacts ──────────────────────────────────────────────────────────────

  /** Reset the per-frame voice budget. A busy board can produce 300 strikes/s. */
  frame () {
    this._budget = 7
    this._slot = 0
    this._frameT0 = this.ready ? this.ctx.currentTime : 0
  }

  /**
   * Steel on brass. A short inharmonic ping plus a noise transient, pitched and
   * brightened by impact speed. Real pachinko's signature sound is a *rain* of
   * these, so the budget matters more than any individual voice.
   *
   * Admitted voices are SPREAD across the frame at 2.4 ms intervals. An earlier
   * 6 ms wall-clock dedupe compared against ctx.currentTime, which is quantized
   * to the render quantum and frozen across one synchronous event batch — so
   * after the first impact of a frame, every other one read the same clock and
   * was dropped. The budget of 7 was unreachable; the real ceiling was one
   * voice per frame, and the board sounded no busier with thirty balls than
   * with three. (Found by the hostile review, reproduced at 183 strikes/s →
   * 50 admitted.) The caller sorts the frame's hits loudest-first, so the
   * budget now spends itself on the strikes that matter.
   */
  impact (speed, surface = 'nail', varnish = 1) {
    if (!this.ready || this._budget <= 0) return
    const now = Math.max(this.ctx.currentTime, this._frameT0 + this._slot * 0.0024)
    this._slot++
    this._budget--

    const ctx = this.ctx
    const s = clamp(speed / 2.2)
    const v = clamp(varnish)
    const base = surface === 'nail' ? 1750 + s * 2100
      : surface === 'vane' ? 620 + s * 500
        : surface === 'ball' ? 2400 + s * 1400
          : 380 + s * 420
    // At varnish 0 the metal loses its ring and becomes a flat tick: same event,
    // no lacquer.
    const amp = (0.05 + 0.16 * s) * (0.45 + 0.55 * v)
    const dur = surface === 'nail' ? 0.055 + 0.05 * s : 0.09

    const g = ctx.createGain()
    g.gain.setValueAtTime(amp, now)
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur)
    g.connect(this.busImpacts)

    // Two inharmonic partials read as struck metal; a harmonic pair reads as a bell.
    for (const [mult, lvl] of [[1, 1], [2.76, 0.5 * v], [5.4, 0.22 * v]]) {
      if (lvl <= 0.001) continue
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(base * mult, now)
      o.frequency.exponentialRampToValueAtTime(base * mult * 0.86, now + dur)
      const og = ctx.createGain(); og.gain.value = lvl
      o.connect(og).connect(g)
      o.start(now); o.stop(now + dur + 0.02)
    }

    const nz = ctx.createBufferSource()
    nz.buffer = this.noise
    nz.playbackRate.value = 1 + s
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = base * 1.4; bp.Q.value = 1.1
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(amp * 0.7, now)
    ng.gain.exponentialRampToValueAtTime(0.0005, now + 0.030)
    nz.connect(bp).connect(ng).connect(this.busImpacts)
    nz.start(now); nz.stop(now + 0.05)
  }

  // ── rewards ──────────────────────────────────────────────────────────────

  tone (freq, dur, amp, type = 'sine', bus = null, delay = 0) {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(amp, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(bus || this.busRewards)
    o.start(t); o.stop(t + dur + 0.02)
  }

  /**
   * A ball found the start pocket.
   *
   * This is the game's own loss disguised as a win, and it is not a contrivance:
   * a heso entry pays three balls, and tools/calibrate.js measures a 2.9% heso
   * rate at the best dial setting — so it costs about thirty-five balls to obtain.
   * The event is a net loss of some thirty balls, and the machine throws a party.
   *
   * At full varnish it gets the party. At varnish 0 it gets a flat, slightly sour
   * tone — which is Dixon et al. (2015), n=157, where attaching a negative sound
   * to losses-disguised-as-wins flipped the majority of players back to
   * categorising them correctly, and restored accurate win estimates.
   *
   * The switch in the options menu is that experiment, wired to a slider.
   */
  heso (varnish = 1) {
    const v = clamp(varnish)
    if (v > 0.5) {
      this.tone(880, 0.16, 0.20 * v, 'triangle')
      this.tone(1320, 0.22, 0.13 * v, 'sine', null, 0.05)
    } else {
      // Unmasked: a dull, slightly flat knock. The truthful sound of a net loss.
      this.tone(196, 0.13, 0.13, 'sine')
      this.tone(185, 0.18, 0.09, 'sine', null, 0.03)
    }
  }

  tulip (varnish = 1) {
    const v = clamp(varnish)
    this.tone(660, 0.14, 0.14 * (0.4 + 0.6 * v), 'triangle')
  }

  /** The reels turning. A dry mechanical tick — no pitch ramp. */
  spinTick (varnish = 1) {
    this.tone(240, 0.035, 0.05 * (0.4 + 0.6 * clamp(varnish)), 'square', this.busImpacts)
  }

  /**
   * A reach: two symbols matched, the third still crawling.
   * The near-miss engine. Tension is built with density and detune, not contour.
   */
  reach (varnish = 1) {
    const v = clamp(varnish)
    if (!this.ready) return
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'
    f.frequency.setValueAtTime(300, t)
    f.frequency.linearRampToValueAtTime(1800, t + 2.2)
    f.Q.value = 6
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.10 * (0.3 + 0.7 * v), t + 0.4)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
    o.connect(f).connect(g).connect(this.busRewards)
    o.start(t); o.stop(t + 2.5)
  }

  /**
   * A losing spin. Silent at full varnish — not because real parlours are quiet
   * (they are among the loudest public spaces in Japan; BGM and reel-stop sounds
   * run continuously) but because what a machine withholds on a loss is the
   * *jingle*. At varnish 0 it gets a tone, which is the unmasking manipulation.
   */
  lose (reach, varnish = 1) {
    if (clamp(varnish) > 0.5) return
    this.tone(140, 0.20, 0.07, 'sine')
  }

  /**
   * Ōatari. Duration scales with the size of the win, per Dixon's 1.5–12 s range.
   * `size` is 0..1.
   */
  jackpot (size = 0.5, varnish = 1) {
    const v = clamp(varnish)
    const dur = 1.5 + 10.5 * clamp(size)
    if (v < 0.5) {
      // Unvarnished: one honest bell and the length of the win, stated once.
      this.tone(330, 0.5, 0.16, 'sine')
      return dur
    }
    // A stack of just-intonation partials over a root — consonant, and it gets
    // longer the more you won, which is the part the literature actually backs.
    const root = 220
    const ratios = [1, 5 / 4, 3 / 2, 2, 5 / 2, 3]
    ratios.forEach((r, i) => {
      this.tone(root * r, dur * (0.5 + 0.5 * (1 - i / ratios.length)), 0.11 * v, 'triangle', null, i * 0.07)
    })
    for (let i = 0; i < Math.round(6 + 14 * size); i++) {
      this.tone(root * ratios[i % ratios.length] * 4, 0.09, 0.05 * v, 'sine', null, 0.25 + i * 0.13)
    }
    return dur
  }

  /**
   * A descending Shepard–Risset glissando, for the duration of a jackpot.
   *
   * Six sine partials spaced exactly one octave apart, all gliding downward at
   * the same rate under a FIXED spectral envelope. When a partial has fallen a
   * full octave it has taken the place of the one below it, so the ensemble is
   * identical to how it started — and the ear, which tracks the envelope rather
   * than any individual partial, hears a fall that never lands. (Shepard, 1964,
   * "Circularity in Judgments of Relative Pitch", JASA; Risset made it continuous.)
   *
   * This is NOT dopamine science and is not dressed as any. It is a documented
   * illusion, used deliberately as an illusion, and that is exactly why it earns
   * its place in this particular game: a machine that appears to be going
   * somewhere and demonstrably is not. A kakuhen chain feels like a build. It is
   * a Shepard tone with a token hopper.
   *
   * Descending rather than ascending on purpose. Ascending is the casino build,
   * and it would also edge toward the rising-pitch-as-reward-cue claim that was
   * cut from this file for lack of evidence. Descending puts a sinking feeling
   * underneath the moment the machine is congratulating you, which is the truer
   * sound of winning at pachinko.
   *
   * At varnish 0 the illusion is dismantled: a single partial descends once and
   * ARRIVES. You get to hear what the trick was doing.
   */
  shepard (duration = 8, varnish = 1, depth = 0, amp = 1) {
    if (!this.ready) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const v = clamp(varnish)
    const SPAN = SHEPARD.span           // octaves covered
    const F_TOP = SHEPARD.fTop          // top of the span, Hz
    const RATE = 60                     // curve samples per second

    if (v < 0.5) {
      // Unvarnished: one honest descent that reaches the bottom and stops.
      const o = ctx.createOscillator(); o.type = 'sine'
      const g = ctx.createGain()
      o.frequency.setValueAtTime(F_TOP / 2, t0)
      o.frequency.exponentialRampToValueAtTime(F_TOP / 2 / Math.pow(2, SPAN), t0 + 3.0)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.10 * amp, t0 + 0.15)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.1)
      o.connect(g).connect(this.busRewards)
      o.start(t0); o.stop(t0 + 3.2)
      return
    }

    // A deeper kakuhen chain descends more slowly — the longer you have been in
    // it, the less the sound seems to be getting anywhere.
    const cycle = 6.4 + Math.min(4, depth) * 0.9      // s for one partial to fall SPAN
    const dur = Math.max(2, duration)
    const n = Math.ceil(dur * RATE)
    const voices = SHEPARD.voices                     // one per octave → true Shepard spacing

    // One bus for the ensemble, so the whole illusion can be faded out cleanly
    // when the jackpot ends rather than being cut mid-descent.
    const bus = ctx.createGain()
    bus.gain.value = 1
    bus.connect(this.busRewards)
    const oscs = []

    for (let i = 0; i < voices; i++) {
      const freq = new Float32Array(n)
      const gain = new Float32Array(n)
      for (let k = 0; k < n; k++) {
        const t = k / RATE
        // Phase 0 = top of the span, 1 = bottom, then wraps. The wrap is silent
        // because the envelope is zero at both ends, which is the whole trick.
        const p = ((t / cycle) + i / voices) % 1
        freq[k] = F_TOP * Math.pow(2, -SPAN * p)
        // `amp` thins the ensemble without changing its geometry — the fall
        // continues through kakuhen at a fraction of its jackpot weight.
        gain[k] = 0.5 * (1 - Math.cos(2 * Math.PI * p)) * 0.075 * v * amp
      }
      // Fade the whole ensemble in and out so it does not click on or off.
      const fade = Math.min(0.6 * RATE, n / 4) | 0
      for (let k = 0; k < fade; k++) {
        gain[k] *= k / fade
        gain[n - 1 - k] *= k / fade
      }

      const o = ctx.createOscillator()
      o.type = 'sine'
      const g = ctx.createGain()
      g.gain.value = 0
      o.connect(g).connect(bus)
      o.frequency.setValueCurveAtTime(freq, t0, dur)
      g.gain.setValueCurveAtTime(gain, t0, dur)
      o.start(t0)
      o.stop(t0 + dur + 0.05)
      oscs.push(o)
    }

    const handle = {
      stop: () => {
        const t = ctx.currentTime
        bus.gain.cancelScheduledValues(t)
        bus.gain.setValueAtTime(bus.gain.value, t)
        bus.gain.linearRampToValueAtTime(0, t + 0.9)
        for (const o of oscs) { try { o.stop(t + 1.0) } catch { /* already stopped */ } }
      }
    }
    this._shep = handle
    return handle
  }

  /** End the glissando — the fall finally stops, because the jackpot did. */
  shepardStop () {
    if (this._shep) { this._shep.stop(); this._shep = null }
  }

  /**
   * The opening sequence — the build before the mouth opens.
   *
   * Two mechanisms, deliberately chosen, and neither is the pitch-contour
   * folklore this file cut in its first draft:
   *
   *   ACCELERATING TEMPO. A tray roll whose interval shortens toward the drop.
   *   Rate, not contour: the same grains the payout tray is made of, arriving
   *   faster. It is also literally what a hopper sounds like spinning up.
   *
   *   OPENING FILTER. A held drone whose brightness climbs — the room's own
   *   noise floor lifting. The pitch of every component is CONSTANT; only the
   *   spectral centroid moves, which is timbre, not melody.
   *
   * The roll resolves INTO the reward motif, so the build becomes a
   * second-order predictor of the family — and it never lies, because it only
   * ever plays when a jackpot has already been won.
   */
  jackpotBuild (dur = 2.6, size = 0.5, varnish = 1) {
    if (!this.ready) return
    const v = clamp(varnish)
    const ctx = this.ctx
    const t0 = ctx.currentTime
    if (v < 0.5) {
      // Unvarnished: one flat tick to mark the sequence, no swell.
      this.tone(300, 0.06, 0.07, 'square', this.busImpacts)
      return
    }

    // The accelerating roll. Intervals follow a geometric squeeze so the last
    // few grains are almost a single sound.
    let t = t0
    let gap = 0.20
    while (t < t0 + dur - 0.05) {
      const nz = ctx.createBufferSource()
      nz.buffer = this.noise
      nz.playbackRate.value = 1.2 + Math.random() * 0.4
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1000 + Math.random() * 500     // tray body, under the rain
      bp.Q.value = 2.2
      const g = ctx.createGain()
      const k = (t - t0) / dur
      g.gain.setValueAtTime(0.045 * (0.5 + 0.9 * k) * v, t)
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06)
      nz.connect(bp).connect(g).connect(this.busRewards)
      nz.start(t); nz.stop(t + 0.08)
      t += gap
      gap = Math.max(0.035, gap * 0.80)
    }

    // The drone: constant pitch, opening filter. Scaled by the size of what
    // is now on the table.
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 110 * 1.5
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'
    f.frequency.setValueAtTime(220, t0)
    f.frequency.linearRampToValueAtTime(2600, t0 + dur)
    f.Q.value = 4
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.075 * (0.6 + 0.4 * clamp(size)) * v, t0 + dur * 0.9)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.10)
    o.connect(f); o2.connect(f)
    f.connect(g).connect(this.busRewards)
    o.start(t0); o.stop(t0 + dur + 0.15)
    o2.start(t0); o2.stop(t0 + dur + 0.15)
  }

  /**
   * Kakuhen: the chain lives. A win-paired chord — the jackpot's just-intonation
   * stack at half weight — whose duration is proportional to the REAL
   * continuation probability (catchP from the spec's own arithmetic), which is
   * the one dial Dixon's data actually supports: bigger win, longer song.
   */
  kakuhen (catchP = 0.65, varnish = 1) {
    const v = clamp(varnish)
    const dur = 1.5 + 3 * clamp(catchP)
    if (v < 0.5) {
      // Unvarnished: the fact, stated once.
      this.tone(262, 0.4, 0.12, 'sine')
      return dur
    }
    const root = 220
    const ratios = [1, 5 / 4, 3 / 2, 2, 5 / 2, 3]
    ratios.forEach((r, i) => {
      this.tone(root * r, dur * (0.5 + 0.5 * (1 - i / ratios.length)) * 0.9, 0.055 * v, 'triangle', null, i * 0.06)
    })
    return dur
  }

  /**
   * Koatari — the small win. Two bright notes and done: win-paired and SHORT,
   * because the prize is small and the duration is the honest part.
   */
  koatari (varnish = 1) {
    const v = clamp(varnish)
    if (v > 0.5) {
      this.tone(660, 0.16, 0.16 * v, 'triangle')
      this.tone(990, 0.30, 0.12 * v, 'triangle', null, 0.09)
    } else {
      this.tone(247, 0.22, 0.11, 'sine')
    }
  }

  /**
   * A foul: the dead sound of a ball falling back onto balls. Deliberately
   * duller than any nail ping — the ear learns foul = thud, play = ring.
   * Mechanism sound; it fires whether or not anything else follows.
   */
  foul (varnish = 1) {
    if (!this.ready) return
    const v = clamp(varnish)
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(118, t + 0.06)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.085 * (0.55 + 0.45 * v), t)
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.065)
    o.connect(g).connect(this.busImpacts)
    o.start(t); o.stop(t + 0.08)
    const nz = ctx.createBufferSource()
    nz.buffer = this.noise
    nz.playbackRate.value = 0.7
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 600
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.05, t)
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.025)
    nz.connect(lp).connect(ng).connect(this.busImpacts)
    nz.start(t); nz.stop(t + 0.04)
  }

  /**
   * The sustained jam: a dry column-rattle while foulHeat sits above the same
   * threshold the HUD names it at. Reads a measured accumulator of real foul
   * events; ticks stop the moment the channel clears.
   */
  updateJam (foulHeat, varnish) {
    if (!this.ready || foulHeat <= 1.6) return
    const t = this.ctx.currentTime
    if (t < (this._jamNext || 0)) return
    this._jamNext = t + 0.22 + Math.random() * 0.10
    const v = clamp(varnish)
    const nz = this.ctx.createBufferSource()
    nz.buffer = this.noise
    nz.playbackRate.value = 0.9
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 3
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.04 * Math.min(1, foulHeat / 3) * (0.5 + 0.5 * v), t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05)
    nz.connect(bp).connect(g).connect(this.busImpacts)
    nz.start(t); nz.stop(t + 0.07)
  }

  /**
   * The attacker's gate: a mechanical thunk opening, a slam plus rattle shutting.
   * Mechanism, not reward — it makes the party's structure audible with eyes
   * closed, which a bare stop-fade never did.
   */
  gate (open, varnish = 1) {
    if (!this.ready) return
    const v = clamp(varnish)
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(open ? 120 : 95, t)
    o.frequency.exponentialRampToValueAtTime(open ? 70 : 50, t + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.11 * (0.5 + 0.5 * v), t)
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.11)
    o.connect(g).connect(this.busImpacts)
    o.start(t); o.stop(t + 0.13)
    if (!open) {
      const nz = ctx.createBufferSource()
      nz.buffer = this.noise
      nz.playbackRate.value = 0.8
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'; lp.frequency.value = 900
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.06 * (0.5 + 0.5 * v), t)
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.05)
      nz.connect(lp).connect(ng).connect(this.busImpacts)
      nz.start(t); nz.stop(t + 0.07)
    }
  }

  /** Balls hitting the tray. The metal roar of being paid. */
  cascade (n, varnish = 1) {
    if (!this.ready) return
    const v = clamp(varnish)
    const count = Math.min(10, Math.max(1, Math.round(n / 3)))
    for (let i = 0; i < count; i++) {
      const ctx = this.ctx
      const t = ctx.currentTime + i * 0.045 + Math.random() * 0.02
      const nz = ctx.createBufferSource()
      nz.buffer = this.noise
      nz.playbackRate.value = 1.4 + Math.random() * 0.8
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2200 + Math.random() * 2600
      bp.Q.value = 2
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.10 * (0.4 + 0.6 * v), t)
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.10)
      nz.connect(bp).connect(g).connect(this.busRewards)
      nz.start(t); nz.stop(t + 0.14)
    }
  }

  /**
   * The hammer striking a ball.
   *
   * A solenoid thunk plus the ring of steel on steel. `worked` is how hard the
   * mechanism is being driven, 0..1 — the harder it is worked the duller and
   * looser the strike, so a machine-gunned session audibly loses its crispness
   * at the same time as it loses its accuracy. Same state, two senses.
   */
  launch (dial = 0.5, worked = 0, varnish = 1) {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const v = clamp(varnish)
    const w = clamp(worked)

    // The solenoid: a short low thud, pitched slightly by draw length.
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150 + dial * 60, t)
    o.frequency.exponentialRampToValueAtTime(58, t + 0.07)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.10 * (0.5 + 0.5 * v), t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09)
    o.connect(g).connect(this.busImpacts)
    o.start(t); o.stop(t + 0.11)

    // The strike itself: a noise transient through a bandpass that dulls as the
    // mechanism heats.
    const nz = ctx.createBufferSource()
    nz.buffer = this.noise
    nz.playbackRate.value = 1.3 + dial * 0.5
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = (2600 - 1200 * w) * (0.85 + 0.3 * dial)
    bp.Q.value = 1.4 - 0.7 * w
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.075 * (0.45 + 0.55 * v) * (1 - 0.35 * w), t)
    ng.gain.exponentialRampToValueAtTime(0.0004, t + 0.030 + 0.02 * w)
    nz.connect(bp).connect(ng).connect(this.busImpacts)
    nz.start(t); nz.stop(t + 0.06)
  }

  /**
   * The pull ratchet: one dry click per detent as the hammer is drawn back.
   *
   * Mechanism sound, not a reward cue. The pitch tracks the spring's
   * compression because a shorter, tighter spring rings higher — that is
   * physics. It is not the ascending-anticipation contour this project cut:
   * it is tied to the player's own hand, runs whether or not any reward
   * follows, and stops the instant they stop pulling.
   */
  ratchet (power = 0, varnish = 1) {
    if (!this.ready) return
    const v = clamp(varnish)
    this.tone(850 + 950 * clamp(power), 0.018, 0.034 * (0.5 + 0.5 * v), 'square', this.busImpacts)
  }

  /** UI. */
  click () { this.tone(520, 0.05, 0.09, 'square', this.busImpacts) }
  select () { this.tone(760, 0.09, 0.11, 'triangle', this.busImpacts) }
}
