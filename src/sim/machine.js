// The rules on top of the physics.
//
// The important structural fact, and the one this file exists to make legible:
// **the start pocket does not pay you. It buys you a lottery ticket.**
//
// In modern pachinko the ball landing in the heso triggers a digital spin whose
// outcome was decided by a random number generator you never touched. Your dial,
// your patience, your read of the nail field — all of it buys you is a higher
// *rate* of tickets. The slot-machine literature calls the resulting absorbed
// state "dark flow" (Dixon et al., J. Gambling Studies 2017; J. Behavioural
// Addictions 2019) — a construct coined for multiline slots, not pachinko, since
// no dark-flow literature on pachinko exists. The mechanism transfers; the
// citation does not, and saying so is the whole point of design law L2.
//
// Pachinkode does not hide this. The spin is drawn openly, the odds are printed
// on the HUD, and the ball's arrival and the spin's verdict are rendered as two
// separate events, because they are two separate events.
//
// Nothing in here touches the renderer or the audio. It emits events; they listen.

import { BOARD, buildBoard, launchPoint, applyTulip, applyAttacker } from './board.js'
import { makeBall, DT } from './world.js'
import { makeRng } from './rng.js'
import { baseLoadout } from './loadout.js'

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
// `koatariOdds` is the 小当たり — the small win, and a real spec feature, not an
// invention: modern machines carry small-bonus outcomes where the attacker
// blinks open briefly (often so briefly players call them silent). Here it is
// one short opening, capped at two entries — a taste of the attacker at odds a
// session will actually meet, so the lottery pays at three tiers: the 3-ball
// entry pay always, koatari sometimes, ōatari rarely.
export const SPECS = {
  amadeji: {
    label: 'AMADEJI 甘デジ',
    note: 'The gentle class. Frequent small jackpots.',
    jackpotOdds: 99, kakuhenOdds: 19.8, kakuhenChance: 0.55, stSpins: 20,
    rounds: 8, payPerEntry: 13, entriesPerRound: 9, koatariOdds: 28
  },
  standard: {
    label: 'STANDARD スペック',
    note: 'The floor workhorse. Long droughts, big rounds.',
    jackpotOdds: 319, kakuhenOdds: 31.9, kakuhenChance: 0.65, stSpins: 38,
    rounds: 10, payPerEntry: 15, entriesPerRound: 10, koatariOdds: 45
  },
  loose: {
    label: 'LOOSE ゆるい',
    note: 'Not a real regulatory class. For watching the machinery work.',
    jackpotOdds: 39, kakuhenOdds: 7.8, kakuhenChance: 0.50, stSpins: 8,
    rounds: 5, payPerEntry: 12, entriesPerRound: 8, koatariOdds: 15
  }
}

/** Mean number of jackpots per chain, from the spec alone. Used by calibrate.js. */
export function chainLength (S) {
  const catchP = 1 - Math.pow(1 - 1 / S.kakuhenOdds, S.stSpins)
  return 1 / (1 - S.kakuhenChance * catchP)
}

// Regulated and near-regulated constants.
export const LAUNCH_INTERVAL = 0.6      // s — 100 balls/min is the legal ceiling

// ── fire rate ───────────────────────────────────────────────────────────────
//
// A real machine may not exceed 100 balls per minute — the ceiling exists so
// that ¥400 a minute is the fastest a person is permitted to lose money at one
// of these. That is a fact about the law, and REGULATION holds it exactly.
//
// The faster settings are this simulator taking the glass off: more balls in
// flight at once, more of the board alive at the same time. They change the
// *tempo* of the machine, not its odds — every ball still costs a token and
// still goes where the physics sends it. The ¥ line in the ledger keeps
// counting at the real rental rate, which at STORM is a number worth seeing.
export const FIRE_RATES = {
  regulation: { label: 'REGULATION 100/min', interval: 0.6 },
  arcade: { label: 'ARCADE 300/min', interval: 0.2 },
  storm: { label: 'STORM 600/min', interval: 0.1 }
}

// ── the pull ────────────────────────────────────────────────────────────────
//
// The control scheme is pull-back-and-release. The BASE slider sets where the
// hammer rests; pressing draws it further back, from base toward full, over
// CHARGE_TIME; releasing fires at whatever the pull reached. A quick tap is
// therefore a shot at base power — which is what makes rapid fire aimable: mash
// the trigger and every ball leaves at roughly the slider's setting, scattered
// only by the heat model below.
export const CHARGE_TIME = 1.1          // s — base to full pull

// ── The launcher's memory ───────────────────────────────────────────────────
//
// A shot fired from rest is precise. A shot fired while the mechanism is still
// recovering from the last one is not.
//
// The physical story: modern machines drive the hammer (打球杆) with a rotary
// solenoid working against a return spring, and a fresh ball has to drop into
// the cradle and settle before it is struck. Flat out at the legal maximum,
// neither has fully seated — the spring is still returning, the coil is warm,
// and the ball is still moving in the cradle when the hammer arrives. Tapping
// out single shots gives all three time to come to rest.
//
// `heat` is a leaky accumulator over recent shots: it rises by one per launch
// and decays with LAUNCH_TAU, so it measures how hard the mechanism has been
// worked lately rather than just the gap since the last shot. Sustained fire is
// therefore worse than one quick double-tap, which is the right shape.
//
// HONESTY NOTE: nobody publishes launcher scatter, and real machines are
// famously consistent — precise aiming at one gap (ぶっこみ狙い) is a recognised
// skill. The mechanism above is plausible and the *direction* is defensible, but
// the magnitudes are a design choice, not a measurement. Marked DESIGN in
// docs/SCIENCE.md and it should stay marked.
const LAUNCH_TAU = 1.2                  // s — how fast the mechanism forgets
const HEAT_FULL = 1.6                   // heat at which scatter is maxed out
export const JITTER_COLD = 0.0035       // relative sd, fired from rest
export const JITTER_HOT = 0.026         // relative sd, firing flat out
export const HESO_PAY = 3               // balls returned for a start-pocket entry
export const TULIP_PAY = 2
// A bucket returns one ball. Deliberately small: a bucket's job is to pay
// POINTS, and if it paid a useful number of balls as well then DEEPER TRAY and
// ANOTHER BUCKET would be the same part. One ball is enough that a good board
// slows its own clock without stopping it.
export const BUCKET_PAY = 1
const HOLD_MAX = 4                      // 保留 — the legal pending-ball queue depth
const SPIN_TIME = 1.9                   // s, base
const REACH_EXTRA = 2.6                 // s of extra crawl when the spin "reaches"
const ROUND_TIME = 18                   // s — legal max is 30
const ATTACKER_SHUT_DELAY = 1.1         // s of grace after the last entry
// One opening, capped. First built as a 1.6 s blink and measured: at the
// recommended base the blink caught 0.00–0.25 entries — a prize that paid
// nothing. Seven seconds is long enough to REACT: crank the dial right and
// harvest, which is exactly the migi-uchi switch a jackpot demands. The small
// win is the tutorial for the big one, and it is skill-gated, not free — sit
// at a left-route base and it still pays you nothing.
const KOATARI_TIME = 7                  // s the attacker opens on a small win
const KOATARI_ENTRIES = 4               // entry cap for that opening

// The opening sequence. The attacker stays SHUT while it runs and the round
// clock does not start, so it costs the player nothing — it is the window in
// which they crank the dial right, the same reaction beat koatari teaches.
//
// What it builds anticipation FOR is genuinely undecided, which is the only
// reason it is allowed to exist in this project. The verdict is already fixed
// (it was fixed the instant the ball entered the pocket, and the reels are a
// readout) — but the HARVEST is not. How much of the ceiling below you take
// depends on what you do in the next three minutes. That is real suspense
// about a real unknown, and it is the opposite of the ascending-anticipation
// folklore this repo cut: nothing here pretends to influence an outcome that
// is already sealed.
const FANFARE_TIME = 2.6                // s of opening sequence before the mouth

export class Machine {
  constructor ({ seed = 1, spec = 'amadeji', tokens = 500, fireInterval = LAUNCH_INTERVAL,
    loadout = null } = {}) {
    // The loadout is the board's argument (see loadout.js). Defaulted here
    // rather than required, so every tool and test written before the roguelike
    // still builds the stock machine by asking for nothing.
    this.loadout = loadout || baseLoadout()
    const built = buildBoard(this.loadout)
    this.world = built.world
    this.parts = built.parts
    this.rng = makeRng(seed)
    this.seed = seed
    this.spec = SPECS[spec] ? spec : 'amadeji'
    this.S = SPECS[this.spec]

    this.dial = 0.20
    this.firing = false
    // The class default is the LEGAL interval. The faster settings are opted
    // into by the shell, never assumed by the simulation.
    this.fireInterval = fireInterval
    this.sinceLaunch = fireInterval         // start ready, so the first tap fires
    this.time = 0

    // The pull. `power` is where the hammer currently sits (== dial at rest,
    // climbing toward 1 while charging); `pending` is a released shot waiting
    // out the lockout — the hammer stays drawn until it is allowed to strike.
    this.charging = false
    this.chargeT = 0
    this.power = this.dial
    this.pending = null
    this.lastPower = this.dial

    // Rolling foul pressure. Rises by one per foul, forgets over ~2.5 s — a
    // sustained channel jam holds it high, a lone weak shot barely moves it.
    // Read by the HUD to name the jam while it is happening; decides nothing.
    this.foulHeat = 0

    // Launcher state. `heat` drives scatter; the rest is read by the renderer.
    this.heat = 0
    this.hammer = 0            // 0 = drawn back, 1 = mid-strike; decays after a shot
    this.lastJitter = JITTER_COLD
    this.lastSpeed = 0
    this.shots = 0

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
    this.spin = null                 // {t, dur, outcome, reach, ko}
    this.kakuhen = 0                 // remaining ST spins at elevated odds
    this.jackpot = null              // {round, entries, t, shutAt, paid}
    this.koatari = null              // {t, entries} — the attacker's blink
    this.spins = 0
    this.jackpots = 0
    this.koataris = 0
    this.lastSymbols = null
    this.lastResolve = null          // {kind: 'win'|'ko'|'lose', reach, at} — read by the display

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

  /** 0..1 — how worked the launcher is right now. 0 is rested, 1 is flat out. */
  get worked () { return Math.min(1, this.heat / HEAT_FULL) }

  /** 0..1 — how close the next shot is to being allowed. Drives the readiness lamp. */
  get readiness () { return Math.min(1, this.sinceLaunch / this.fireInterval) }

  /**
   * Begin drawing the hammer back. Idempotent — key auto-repeat and a second
   * pointer must not restart a pull already in progress.
   */
  beginCharge () {
    if (this.charging) return
    this.charging = true
    this.chargeT = 0
    this.emit('chargeStart', { base: this.dial })
  }

  /**
   * Let go. The shot fires at whatever the pull reached, immediately if the
   * lockout allows it, otherwise the instant it next does — the hammer stays
   * visibly drawn in the meantime, which is the honest rendering of "buffered".
   * One shot deep: releasing twice before the lockout clears is still one ball.
   */
  releaseCharge () {
    if (!this.charging) return
    this.charging = false
    // First release wins. A buffered pull must not be silently overwritten by
    // a quick tap behind it — the tap would swap a charged shot's power for
    // base with no launch and no event to say so. (Found by review: the old
    // "one ball" comment was true of the count and hid the power swap.)
    if (this.pending) return
    this.pending = { power: this.power }
    this.emit('chargeRelease', { power: this.power })
  }

  /**
   * A drum hit: queue a base-power shot directly, no charge state involved.
   * This is how a SECOND finger fires while the first owns the pull — each
   * extra tap is its own shot, subject to the same one-deep buffer and the
   * same lockout as everything else.
   */
  tap () {
    if (this.pending) return
    this.pending = { power: this.dial }
    this.emit('chargeRelease', { power: this.dial })
  }

  /** Abandon a pull without firing — leaving the play screen, mostly. */
  cancelCharge () {
    this.charging = false
    this.chargeT = 0
    this.pending = null
    this.power = this.dial
  }

  /** Relative sd the NEXT shot would get, if fired this instant. */
  get nextJitter () { return JITTER_COLD + (JITTER_HOT - JITTER_COLD) * this.worked }

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
    // Koatari settles as an outer pair with the middle far off — visually a
    // near-miss, which is faithful: real small wins often LOOK like bare
    // misses plus an attacker twitch. The label and the sound do the telling.
    if (this.spin.ko) return [a, (a + 4) % 8, a]
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
    // The mechanism forgets its last shot exponentially.
    this.heat *= Math.exp(-dt / LAUNCH_TAU)
    this.hammer *= Math.exp(-dt / 0.055)
    this.foulHeat *= Math.exp(-dt / 2.5)

    // The pull. While the trigger is held the hammer draws back from the base
    // toward full; while a released shot waits out the lockout it stays where
    // the pull left it; otherwise it rests at the base.
    if (this.charging) {
      this.chargeT += dt
      this.power = this.dial + (1 - this.dial) * Math.min(1, this.chargeT / CHARGE_TIME)
    } else if (!this.pending) {
      this.power = this.dial
    }

    if ((this.pending || this.firing) && this.sinceLaunch >= this.fireInterval) {
      // Reset to zero rather than carrying the remainder forward. Two reasons,
      // and both are about the ceiling being a LEGAL one:
      //
      //   Carrying credit lets a long idle bank seconds of `sinceLaunch`, and the
      //   next trigger press then empties a burst of balls in consecutive frames.
      //
      //   Even during steady fire, carrying lets discretisation shave a tick off
      //   a gap — measured mean 0.599995 s, which is 100.0008 balls/minute and
      //   therefore over. Zeroing rounds every interval UP to the next tick, so
      //   the machine can only ever fire slower than the ceiling, never faster.
      //   For a limit you are not allowed to exceed, that is the correct
      //   direction to be wrong in. (The faster FIRE_RATES are opted into by the
      //   shell; whatever the interval, the same rounding-up discipline applies.)
      //
      //   Zeroed only when a ball actually leaves: an empty-handed release
      //   launches nothing, consumes none of the ceiling, and must not make the
      //   first shot after a top-up wait out a lockout the mechanism never
      //   earned. (Found by review — the readiness lamp was reporting a
      //   recovery that never happened.)

      if (this.tokens > 0) {
        this.sinceLaunch = 0
        // A released pull outranks the autofire trigger, and fires at the power
        // the pull reached. Autofire (tools, the debug handle) fires at base.
        const p = this.pending ? this.pending.power : this.dial
        this.pending = null
        this.lastPower = p

        this.tokens--
        this.spent++
        this.launched++
        this.shots++

        // Scatter is read BEFORE this shot's own heat is added, so a shot fired
        // from rest gets the cold figure.
        const worked = Math.min(1, this.heat / HEAT_FULL)
        const jitter = JITTER_COLD + (JITTER_HOT - JITTER_COLD) * worked
        this.lastJitter = jitter
        this.heat += 1
        this.hammer = 1

        const lp = launchPoint()
        const s = this.speedFor(p) * (1 + this.rng.normal(0, jitter))
        this.lastSpeed = s
        w.spawn(makeBall(lp.x, lp.y, lp.dx * s, lp.dy * s, { dial: p }))
        this.emit('launch', { speed: s, dial: this.dial, power: p, jitter, worked })
      } else {
        this.firing = false
        this.pending = null
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
        const out = this.world.spawn(makeBall(x, st.y, vx, 0.05, { warped: true }))
        // `from` lets the value model carry the ball's history across the warp.
        // It is the same ball: the trip that found the warp is part of what made
        // it valuable, and dropping the history here both loses that credit and
        // orphans the visit set.
        this.emit('warp', { x: ev.x, y: ev.y, ball: ev.ball, into: out })
        break
      }
      case 'chucker':
        this.pay(HESO_PAY, 'heso')
        this.emit('heso', { x: ev.x, y: ev.y, holds: this.holds, ball: ev.ball })
        if (this.holds < HOLD_MAX) {
          this.holds++
        } else {
          // Overflow: the ball paid, but bought no ticket. A real machine simply
          // swallows it. Worth surfacing — it is a small, legal theft of agency.
          this.emit('holdOverflow', {})
        }
        break
      case 'bucket': {
        // A scoring bucket. It pays a ball back and it emits — the SCORE it is
        // worth is not computed here, because scoring belongs to the run and
        // the run is not part of the machine. See run.js. Keeping the number
        // out of this file is what lets a Machine still be built and measured
        // with no run at all, which is what every calibration tool does.
        const bk = this.parts.buckets.find(b => b.site === ev.sensor)
        this.pay(BUCKET_PAY, 'bucket')
        this.emit('bucket', {
          x: ev.x, y: ev.y, site: ev.sensor, value: bk ? bk.value : 1,
          n: BUCKET_PAY, ball: ev.ball
        })
        break
      }
      case 'tulip':
        this.pay(TULIP_PAY, 'tulip')
        this.emit('tulip', { x: ev.x, y: ev.y, id: ev.sensor, ball: ev.ball })
        break
      case 'attacker':
        if (this.jackpot) {
          this.pay(this.S.payPerEntry, 'attacker')
          this.jackpot.entries++
          this.jackpot.paid += this.S.payPerEntry
          this.jackpot.shutAt = this.time + ATTACKER_SHUT_DELAY
          this.emit('attacker', {
            x: ev.x, y: ev.y, entries: this.jackpot.entries,
            n: this.S.payPerEntry, total: this.jackpot.paid, ball: ev.ball
          })
          if (this.jackpot.entries >= this.S.entriesPerRound) this.endRound()
        } else if (this.koatari) {
          // The blink catches what it catches. Same mouth, same pay, no rounds.
          this.pay(this.S.payPerEntry, 'attacker')
          this.koatari.entries++
          this.emit('attacker', {
            x: ev.x, y: ev.y, entries: this.koatari.entries,
            n: this.S.payPerEntry, total: this.koatari.entries * this.S.payPerEntry,
            ko: true, ball: ev.ball
          })
        }
        break
      case 'foul':
        // A shot too weak to crest never entered play. Real machines refund it.
        this.tokens++
        this.spent--
        this.foulHeat += 1
        this.emit('foul', { x: ev.x, y: ev.y, ball: ev.ball })
        break
      case 'out':
        this.emit('drain', { x: ev.x, y: ev.y, kind: ev.kind, ball: ev.ball })
        break
      case 'stuck': {
        // A reaped ball INSIDE THE LAUNCH CHANNEL never entered play — it died
        // in traffic, stacked in a column during a channel jam. Those are foul
        // balls and the token comes back, exactly as a too-weak shot's does; a
        // real machine's foul path returns them to the tray. A ball stuck out
        // in the field, by contrast, was in play and is a loss.
        const R = BOARD.rail
        const d = Math.hypot(ev.x - R.cx, ev.y - R.cy)
        let a = Math.atan2(ev.y - R.cy, ev.x - R.cx) * 180 / Math.PI
        if (a < 0) a += 360
        // Radial bound at the inner wall's CENTERLINE. True channel centers lie
        // ≥ 7 mm outside it; a field ball resting against the wall's field face
        // sits ≥ 7 mm inside it. An earlier −8 mm slack put the bound 0.7 mm on
        // the field side of the wall, where it could refund a legitimately
        // spent field ball — slack that protected an empty set (review find).
        const inChannel = d > R.r - R.gap && a > BOARD.railStart - 12 && a < BOARD.railInnerEnd + 5
        if (inChannel) {
          this.tokens++
          this.spent--
          this.foulHeat += 1
          this.emit('foul', { x: ev.x, y: ev.y, ball: ev.ball })
        } else {
          this.emit('drain', { x: ev.x, y: ev.y, kind: ev.kind, ball: ev.ball })
        }
        break
      }
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

    // The small win's blink. Holds wait it out — it is brief by design.
    if (this.koatari) {
      const k = this.koatari
      k.t += dt
      if (k.t >= KOATARI_TIME || k.entries >= KOATARI_ENTRIES) {
        this.parts.attacker.open = false
        this.koatari = null
        this.emit('koatariEnd', { entries: k.entries })
      }
      return
    }

    if (this.spin) {
      this.spin.t += dt
      if (this.spin.t >= this.spin.dur) {
        const { outcome, reach, ko } = this.spin
        this.lastSymbols = this.spinSymbols()
        this.spin = null
        this.spins++
        const wasKakuhen = this.kakuhen > 0
        if (wasKakuhen) this.kakuhen--
        this.lastResolve = { kind: outcome ? 'win' : ko ? 'ko' : 'lose', reach, at: this.time }
        if (outcome) this.startJackpot()
        else if (ko) this.startKoatari()
        else this.emit('spinLose', { reach })
        // The chain dying quietly is an event too — the ST spins ran out with
        // no hit. Without it the thinned Shepard descent under kakuhen would
        // keep falling long after the chain it was falling for was gone.
        if (wasKakuhen && this.kakuhen === 0 && !outcome) this.emit('kakuhenEnd', {})
      }
      return
    }

    if (this.holds > 0) {
      this.holds--
      const odds = this.odds
      const win = this.rng() < 1 / odds
      // The small win rides the same ticket at much better odds. Decided here,
      // like everything, the instant the spin begins.
      const ko = !win && this.rng() < 1 / this.S.koatariOdds
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
        reach,
        ko
      }
      this.emit('spinStart', { odds, reach, holds: this.holds, kakuhen: this.kakuhen > 0 })
    }
  }

  startKoatari () {
    this.koataris++
    // A party is thrown — a small one — and it counts as a party. Whether it
    // was net-positive is judged the same way as everything else: it usually
    // is not, and the gap is the finding.
    this.celebrations++
    this.koatari = { t: 0, entries: 0 }
    this.parts.attacker.open = true
    this.emit('koatari', {})
  }

  startJackpot () {
    this.jackpots++
    // Chain depth: how many jackpots deep into an unbroken kakuhen run we are.
    // Read by the presentation layer, which slows the descending glissando as it
    // grows — the deeper in, the less the sound seems to be getting anywhere.
    this.chainDepth = (this.kakuhen > 0 ? (this.chainDepth || 0) : 0) + 1
    this.jackpot = { round: 1, entries: 0, t: 0, shutAt: 0, paid: 0, fanfare: FANFARE_TIME }
    this.parts.attacker.open = false     // opens when the sequence ends
    this.celebrations++
    this.netPositiveEvents++
    this.emit('jackpot', {
      rounds: this.S.rounds,
      kakuhen: this.kakuhen > 0,
      depth: this.chainDepth,
      // The ceiling, stated up front. It is a real number — rounds × entries
      // × pay — and the sequence's length scales with it, which is the one
      // dial the gambling-audio literature actually supports.
      potential: this.S.rounds * this.S.entriesPerRound * this.S.payPerEntry,
      build: FANFARE_TIME
    })
  }

  tickJackpot (dt) {
    const j = this.jackpot
    if (j.fanfare > 0) {
      j.fanfare -= dt
      if (j.fanfare <= 0) {
        j.fanfare = 0
        this.parts.attacker.open = true
        this.emit('jackpotOpen', { round: 1, of: this.S.rounds })
      }
      return                             // the round clock waits for the mouth
    }
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
