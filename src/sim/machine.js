// The rules on top of the physics.
//
// The important structural fact, and the one this file exists to make legible:
// **the start pocket does not pay you. It buys you a lottery ticket.**
//
// In modern pachinko the ball landing in the heso triggers a digital spin whose
// outcome was decided by a random number generator you never touched. Your dial,
// your patience, your read of the nail field — all of it buys you is a higher
// *rate* of tickets. The pachinko literature calls the resulting play "dark flow";
// the machine calls it Tuesday.
//
// Pachinkode does not hide this. The spin is drawn openly, the odds are printed
// on the HUD, and the ball's arrival and the spin's verdict are rendered as two
// separate events, because they are two separate events.
//
// Nothing in here touches the renderer or the audio. It emits events; they listen.

import { buildBoard, launchPoint, applyTulip, applyAttacker } from './board.js'
import { makeBall, DT } from './world.js'
import { makeRng } from './rng.js'

/**
 * Machine specifications. These are real classes of Japanese machine, not
 * invented difficulty tiers. "Amadeji" (甘デジ, literally "sweet digital") is the
 * gentle, high-frequency, low-payout class; "standard" is the ~1/319 workhorse
 * most parlour floors are built from.
 *
 * The regulation caps the ratio between the high- and low-probability states at
 * 10×, and every entry here respects it.
 */
// ST length is not a free parameter — it *is* the continuation probability.
// Over N spins at odds 1/k the chance of catching another jackpot is
// 1 − (1 − 1/k)^N, and that number, times the chance of entering kakuhen at all,
// sets the mean chain length 1/(1 − p_enter·p_catch).
//
// The first draft gave amadeji 60 ST spins at 1/19.8, which is a 95.5% catch —
// jackpots chained almost without end and the machine returned 143%, over the
// legal ceiling. Each entry below is now solved for a ~65% catch, which is
// roughly where real ST machines sit.
export const SPECS = {
  amadeji: {
    label: 'AMADEJI 甘デジ',
    note: 'The gentle class. Frequent small jackpots.',
    jackpotOdds: 99, kakuhenOdds: 19.8, kakuhenChance: 0.55, stSpins: 20,
    rounds: 8, payPerEntry: 13, entriesPerRound: 9
  },
  standard: {
    label: 'STANDARD スペック',
    note: 'The floor workhorse. Long droughts, big rounds.',
    jackpotOdds: 319, kakuhenOdds: 31.9, kakuhenChance: 0.65, stSpins: 38,
    rounds: 10, payPerEntry: 15, entriesPerRound: 10
  },
  loose: {
    label: 'LOOSE ゆるい',
    note: 'Not a real regulatory class. For watching the machinery work.',
    jackpotOdds: 39, kakuhenOdds: 7.8, kakuhenChance: 0.50, stSpins: 8,
    rounds: 5, payPerEntry: 12, entriesPerRound: 8
  }
}

/** Mean number of jackpots per chain, from the spec alone. Used by calibrate.js. */
export function chainLength (S) {
  const catchP = 1 - Math.pow(1 - 1 / S.kakuhenOdds, S.stSpins)
  return 1 / (1 - S.kakuhenChance * catchP)
}

// Regulated and near-regulated constants.
export const LAUNCH_INTERVAL = 0.6      // s — 100 balls/min is the legal ceiling
export const HESO_PAY = 3               // balls returned for a start-pocket entry
export const TULIP_PAY = 2
const HOLD_MAX = 4                      // 保留 — the legal pending-ball queue depth
const SPIN_TIME = 1.9                   // s, base
const REACH_EXTRA = 2.6                 // s of extra crawl when the spin "reaches"
const ROUND_TIME = 18                   // s — legal max is 30
const ATTACKER_SHUT_DELAY = 1.1         // s of grace after the last entry

export class Machine {
  constructor ({ seed = 1, spec = 'amadeji', tokens = 500 } = {}) {
    const built = buildBoard()
    this.world = built.world
    this.parts = built.parts
    this.rng = makeRng(seed)
    this.seed = seed
    this.spec = SPECS[spec] ? spec : 'amadeji'
    this.S = SPECS[this.spec]

    this.dial = 0.55
    this.firing = false
    this.sinceLaunch = 0
    this.time = 0

    // The token ledger. Three numbers, all shown to the player.
    //   spent    — tokens converted into balls
    //   won      — tokens paid back out of pockets
    //   conjured — tokens that appeared because the player asked for more
    // Real parlours show you only a ball counter. Showing all three is the point.
    this.tokens = tokens
    this.spent = 0
    this.won = 0
    this.conjured = tokens
    this.launched = 0

    // Lottery state.
    this.holds = 0
    this.spin = null                 // {t, dur, outcome, reach}
    this.kakuhen = 0                 // remaining ST spins at elevated odds
    this.jackpot = null              // {round, entries, t, shutAt}
    this.spins = 0
    this.jackpots = 0
    this.lastSymbols = null

    // The felt ledger vs the money ledger — see docs/SCIENCE.md §LDW. These are
    // allowed to disagree, and the disagreement is the finding.
    this.celebrations = 0            // times the machine threw a party
    this.netPositiveEvents = 0       // times the party was actually deserved

    this.events = []
    this.lastBalls = 0
  }

  emit (type, data = {}) { this.events.push({ type, t: this.time, ...data }) }
  drain () { const e = this.events; this.events = []; return e }

  get odds () { return this.kakuhen > 0 ? this.S.kakuhenOdds : this.S.jackpotOdds }

  /**
   * The three symbols the display will settle on, derived from the spin index
   * and the already-decided outcome.
   *
   * Deliberately consumes no RNG: the reels are a *readout* of a verdict that
   * was reached the instant the ball entered the pocket, not a second lottery.
   * That is exactly how a real machine works, and it is the fact the whole game
   * is pointing at — by the time you are watching the reels, nothing is left to
   * decide. Drawing from the RNG here would also shift the outcome stream and
   * break replay determinism.
   */
  spinSymbols () {
    if (!this.spin) return null
    // The final >>> 0 is load-bearing: `x ^= x >>> 15` yields a SIGNED 32-bit
    // result, and a negative modulo 8 is negative. Without it the reels display
    // symbols like "-1" and "-4".
    const h = (n) => { let x = Math.imul(n, 2654435761) >>> 0; x = (x ^ (x >>> 15)) >>> 0; return x }
    const i = this.spins + 1
    const a = h(i * 3) % 8
    if (this.spin.outcome) return [a, a, a]
    if (this.spin.reach) return [a, (a + 1 + h(i * 7) % 7) % 8, a]
    return [a, (a + 1 + h(i * 7) % 7) % 8, (a + 2 + h(i * 11) % 6) % 8]
  }
  get inJackpot () { return this.jackpot !== null }
  /** Return-to-player over the session so far, as a fraction. */
  get rtp () { return this.spent > 0 ? this.won / this.spent : 0 }

  addTokens (n) { this.tokens += n; this.conjured += n; this.emit('conjure', { n }) }

  /**
   * Dial → muzzle velocity.
   *
   * No published measurement of a real launcher's muzzle velocity exists — this
   * is derived from the rail climb plus the sliding-to-rolling loss, and it is
   * the weakest-sourced number in the simulation. What *is* solid is the shape:
   * the usable band is narrow, because the rail eats nearly all the energy, and
   * a real handle's useful travel is a small arc for exactly this reason.
   */
  speedFor (dial) { return 2.85 + dial * 1.35 }

  step (dt) {
    this.time += dt
    const w = this.world

    // --- launcher ---------------------------------------------------------
    this.sinceLaunch += dt
    if (this.firing && this.sinceLaunch >= LAUNCH_INTERVAL) {
      this.sinceLaunch -= LAUNCH_INTERVAL
      if (this.tokens > 0) {
        this.tokens--
        this.spent++
        this.launched++
        const lp = launchPoint()
        // Real launchers scatter. A solenoid-driven hammer striking a steel ball
        // is repeatable to maybe a percent, and that percent is the difference
        // between the two routes when the dial sits on the threshold.
        const s = this.speedFor(this.dial) * (1 + this.rng.normal(0, 0.010))
        w.spawn(makeBall(lp.x, lp.y, lp.dx * s, lp.dy * s, { dial: this.dial }))
        this.emit('launch', { speed: s, dial: this.dial })
      } else {
        this.firing = false
        this.emit('empty')
      }
    }

    // --- physics ----------------------------------------------------------
    w.advance(dt)
    for (const t of this.parts.tulips) applyTulip(t, dt)
    applyAttacker(this.parts.attacker, dt)

    // --- pockets ----------------------------------------------------------
    for (const ev of w.drainEvents()) {
      if (ev.type === 'hit') { this.emit('hit', ev); continue }
      if (ev.type !== 'sensor') continue
      this.onPocket(ev)
    }

    this.tickLottery(dt)
    return this
  }

  onPocket (ev) {
    switch (ev.kind) {
      case 'warp': {
        // The stage (ステージ). A warped ball is not consumed — it is carried
        // inside the housing and released above the heso, which is by far its
        // best chance of a spin. This route is the reason warps feel lucky.
        const st = this.parts.stage
        const x = st.x + this.rng.range(-st.halfWidth, st.halfWidth)
        const vx = this.rng.range(-0.10, 0.10)
        this.world.spawn(makeBall(x, st.y, vx, 0.05, { warped: true }))
        this.emit('warp', { x: ev.x, y: ev.y })
        break
      }
      case 'chucker':
        this.pay(HESO_PAY, 'heso')
        this.emit('heso', { x: ev.x, y: ev.y, holds: this.holds })
        if (this.holds < HOLD_MAX) {
          this.holds++
        } else {
          // Overflow: the ball paid, but bought no ticket. A real machine simply
          // swallows it. Worth surfacing — it is a small, legal theft of agency.
          this.emit('holdOverflow', {})
        }
        break
      case 'tulip':
        this.pay(TULIP_PAY, 'tulip')
        this.emit('tulip', { x: ev.x, y: ev.y, id: ev.sensor })
        break
      case 'attacker':
        if (this.jackpot) {
          this.pay(this.S.payPerEntry, 'attacker')
          this.jackpot.entries++
          this.jackpot.shutAt = this.time + ATTACKER_SHUT_DELAY
          this.emit('attacker', { x: ev.x, y: ev.y, entries: this.jackpot.entries })
          if (this.jackpot.entries >= this.S.entriesPerRound) this.endRound()
        }
        break
      case 'foul':
        // A shot too weak to crest never entered play. Real machines refund it.
        this.tokens++
        this.spent--
        this.emit('foul', { x: ev.x, y: ev.y })
        break
      case 'out':
      case 'stuck':
        this.emit('drain', { x: ev.x, y: ev.y, kind: ev.kind, ball: ev.ball })
        break
    }
  }

  pay (n, source) {
    this.tokens += n
    this.won += n
    this.emit('pay', { n, source })
  }

  // --- the lottery ---------------------------------------------------------

  tickLottery (dt) {
    if (this.jackpot) { this.tickJackpot(dt); return }

    if (this.spin) {
      this.spin.t += dt
      if (this.spin.t >= this.spin.dur) {
        const { outcome, reach } = this.spin
        this.lastSymbols = this.spinSymbols()
        this.spin = null
        this.spins++
        if (this.kakuhen > 0) this.kakuhen--
        if (outcome) this.startJackpot()
        else this.emit('spinLose', { reach })
      }
      return
    }

    if (this.holds > 0) {
      this.holds--
      const odds = this.odds
      const win = this.rng() < 1 / odds
      // A "reach" (リーチ) is the near-miss engine: two symbols match and the
      // third crawls. Clark et al. (2009) found near-misses recruit the same
      // reward circuitry as wins while being rated *less* pleasant — and,
      // crucially, only raise motivation when the player chose the gamble.
      // Here the player did choose: they set the dial that put the ball in.
      // The reach rate is deliberately far above the win rate, exactly as on a
      // real machine.
      const reach = win || this.rng() < 0.14
      this.spin = {
        t: 0,
        dur: SPIN_TIME + (reach ? REACH_EXTRA : 0),
        outcome: win,
        reach
      }
      this.emit('spinStart', { odds, reach, holds: this.holds, kakuhen: this.kakuhen > 0 })
    }
  }

  startJackpot () {
    this.jackpots++
    // Chain depth: how many jackpots deep into an unbroken kakuhen run we are.
    // Read by the presentation layer, which slows the descending glissando as it
    // grows — the deeper in, the less the sound seems to be getting anywhere.
    this.chainDepth = (this.kakuhen > 0 ? (this.chainDepth || 0) : 0) + 1
    this.jackpot = { round: 1, entries: 0, t: 0, shutAt: 0 }
    this.parts.attacker.open = true
    this.celebrations++
    this.netPositiveEvents++
    this.emit('jackpot', {
      rounds: this.S.rounds,
      kakuhen: this.kakuhen > 0,
      depth: this.chainDepth
    })
  }

  tickJackpot (dt) {
    const j = this.jackpot
    j.t += dt
    if (j.t >= ROUND_TIME || (j.shutAt && this.time > j.shutAt && j.entries > 0)) this.endRound()
  }

  endRound () {
    const j = this.jackpot
    if (!j) return
    if (j.round >= this.S.rounds) {
      this.parts.attacker.open = false
      this.jackpot = null
      // Kakuhen (確変): the post-jackpot high-probability state. The regulation
      // permits at most a 10× swing and only lets it begin when a jackpot ends.
      if (this.rng() < this.S.kakuhenChance) {
        this.kakuhen = this.S.stSpins
        this.emit('kakuhen', { spins: this.kakuhen, odds: this.S.kakuhenOdds })
      } else {
        this.emit('jackpotEnd', {})
      }
      return
    }
    j.round++
    j.entries = 0
    j.t = 0
    j.shutAt = 0
    this.emit('round', { round: j.round, of: this.S.rounds })
  }
}
