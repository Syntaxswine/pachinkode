// The run: floors, a quota, a chain, and a number that has to go up.
//
// ── WHY THIS IS A SEPARATE OBJECT ───────────────────────────────────────────
//
// A Run OBSERVES a Machine. It never reaches into one. That is the same
// relationship the Dopamine model already has, and it is not an aesthetic
// preference — it is the only way the varnish argument survives contact with a
// roguelike.
//
// The original claim was: presentation is everything, content is nothing, and
// here is a slider that proves it. A scoring layer is a real hazard to that
// claim, because a score is exactly the kind of thing that wants to reach back
// into the simulation and make the balls behave differently when it is high.
// So it does not get to. The Machine emits what happened; the Run decides what
// it was worth; the renderer and synth decide how loud to be about it. Three
// layers, one direction, and `test/varnish.test.js` still passes unchanged.
//
// The practical payoff is that `tools/calibrate.js` can measure the economy of
// any loadout with no Run attached at all — which is how the difficulty curve
// below was set from data instead of from a feeling.
//
// ── THE SHAPE OF THE DIFFICULTY ─────────────────────────────────────────────
//
// The operator asked for: much harder at the start, and past a threshold of
// unlocks, increasingly easy to reach absurd scores.
//
// That is a statement about two curves, and getting them to cross took four
// attempts and an instrument. What follows is what the instrument said, because
// every one of my guesses was wrong in a way that only measurement caught.
//
// The wall grows GEOMETRICALLY: a fixed ratio per floor. A part is worth a
// measured **×1.30** of scoring power (`node tools/run-sim.js --power`), and I
// assumed ×1.25 twice while setting the growth ratio to 1.72 and then 1.40 —
// both of which make every floor strictly worse than the last, forever, with no
// crossover reachable at ANY quota base. One part per floor against a geometric
// wall is two straight lines on a log plot; lowering the ratio only moves where
// the parallel lines sit.
//
// A crossover needs the player's curve to be a different SHAPE, not a different
// slope. That is what `picksFor` below is: the number of parts per floor RISES
// with depth, so the player's power is geometric in the cumulative pick count,
// which is quadratic in the floor number. Quadratic exponent beats linear
// exponent eventually, and "eventually" is tunable to land where it should.
//
// The other correction was about what "hard" means. Floor clear rates COMPOUND
// — four floors at 50% means six per cent of runs see floor 5 — so a brutal
// early failure rate does not produce a hard game, it produces a game nobody
// sees past the second screen. The early difficulty lives in the MARGIN
// instead: what a floor COSTS to meet, as a fraction of its tray.
//
//     node tools/run-sim.js --curve
//
// prints all of it. Measured at the current constants (10 runs, thrifty push):
//
//     floor  1   69% of the tray to meet the quota,  70% of runs clear it
//     floor  2  205%   ← the real wall, and it is not floor 1
//     floor  3  155%
//     floor  4   46%
//     floor  6   57%
//     floor  7    9%   ← crossover
//     floor 12    1%
//
// Floors 2–3 costing MORE than a full tray is not a bug: BALL RETURN refunds
// stretch the allowance, so a floor can spend twice what it started with. The
// shape worth noticing is that floor 1 is a FILTER and floors 2–3 are the
// CRUNCH — the run's hardest moment arrives after the player has had one part
// and thinks they understand it.
//
// If a retune pushes the crossover past floor 9 the run has become a wall;
// below floor 4 the early game has stopped being hard. Both are regressions
// and both are visible in one command.
//
// One caution for whoever retunes: the cost column measures launches spent
// when the QUOTA WAS MET (`launchedAtQuota`), not when the floor ended. Once
// PUSH ON existed, cost-at-floor-end measured the player's policy rather than
// the board's difficulty — a player who pushes spends the whole tray by
// definition. Measured across all three push policies the clear rate and
// crossover are identical, which is the check that the metric is now reading
// the right thing.

import { resolveLoadout, drawOffers } from './loadout.js'
import { makeRng } from './rng.js'

// ── scoring ─────────────────────────────────────────────────────────────────
//
// Base point values, before any multiplier. The ratios are the design content
// here, not the absolute numbers — the quota curve is fitted to whatever these
// are, so scaling all of them changes nothing at all.
//
// The ordering is an argument. A bucket is worth more than a start-pocket entry
// because a bucket is an honest prize and the start pocket is a lottery ticket
// wearing a prize's clothing; the game has spent its whole existence saying so
// and it would be strange for the scoreboard to disagree. The lottery pays its
// real value in the JACKPOT line instead, which is enormous and almost never
// arrives — which is also the point.
export const SCORE = {
  bucket: 120,
  heso: 45,
  tulip: 30,
  attacker: 60,
  koatari: 400,
  jackpot: 1500,
  warp: 15          // the shortcut itself is worth something, quietly
}

/** Chain multiplier at a given chain length. */
export function chainMult (chain, L) {
  return 1 + Math.min(L.comboCap, chain) * L.comboStep
}

// ── THE KEYSTONE: WHERE THE SCORE CAME FROM ─────────────────────────────────
//
// Declared here, accumulated in `add()`, and read by NOTHING. That is the same
// contract Builder 1 used for nail bending and Builder 2 for the conditioning
// ledger, and it is deliberate: see docs/HANDOFF.md.
//
// ── the claim ───────────────────────────────────────────────────────────────
//
// This project's whole argument is that the lottery is the con — that the start
// pocket does not pay you, it sells you a ticket, and the machine throws a
// party for a net loss of thirty balls. Every document here says so. The game
// has never been able to PROVE it about a particular session, because until the
// roguelike there was no single number a session could be summarised by.
//
// Now there is one, and a score has something a ledger never had: PROVENANCE.
// Every point entered through a named pocket, and the pockets divide cleanly:
//
//   aimed    a place on the board a dial setting can be pointed at. A bucket,
//            a tulip, a warp, the start pocket itself. You did this.
//   lottery  a payout that exists because an RNG you never touched said so —
//            the jackpot, the small win, and the attacker entries they open.
//            You were present for this.
//
// The split is a FALSIFIABLE CLAIM about the design, in the same way CUE_FAMILY
// is a falsifiable claim about the sounds. If a future builder adds a scoring
// source and does not classify it, a test fails.
//
// ── and the third axis ──────────────────────────────────────────────────────
//
// The chain multiplier is neither. It is tempo — the reward for keeping the
// board alive, which is the one thing in this game that is purely a function of
// how the player is playing rather than where the ball went. So `fromChain`
// tracks it separately: of the points you scored, how many existed only because
// you were holding a chain together.
//
// base + fromChain === score, exactly, and a test pins that.
//
// ── what it is FOR ──────────────────────────────────────────────────────────
//
// Nothing reads it yet. The unbuilt consumer is the end-of-run screen, and it
// would say something no gambling machine has ever said to anybody:
//
//     4,182,300 points.
//     91% of it came from pockets you aimed at.
//     9% came from a lottery you did not touch, and could not have.
//     A third of your total existed only because you kept a chain alive.
//
// That is the varnish argument finally closing on the player's own session
// rather than on a slider — and it is the natural partner to Builder 2's
// conditioning ledger, which measures what the machine TAUGHT you while this
// measures what it PAID you for. Between them the last screen of this game
// could be an honest receipt for an evening, itemised two ways.
//
// ── a pilot measurement, because guessing was cheaper to check than to hedge ─
//
// One 400-ball floor on two cabinets, as soon as the ledger was wired:
//
//                 score    lottery   fromChain   sources
//   floor         3,402       0.0%       50.4%   bucket 46, heso 22, warp 18, tulip 14
//   uramono     274,597       2.3%       78.6%   bucket 76, warp 11, heso 10, …
//
// Two things fall out immediately, and only one was expected.
//
// EXPECTED: the lottery share is higher on URAMONO than on the stock machine.
// The game's most desirable cabinet does hand more credit to an RNG you never
// touched — the exhibit makes its own argument, quietly, without anybody having
// written a word of it.
//
// NOT EXPECTED, AND MUCH LARGER: **most of the score is the chain.** Half of it
// on the stock board, four fifths on a built one. The single biggest source of
// points in this game is not any pocket — it is the player keeping the board
// alive, which is the one quantity here that is purely a function of how they
// are playing rather than where a ball happened to fall. A gambling machine
// that pays overwhelmingly for tempo and attention is a strange object, and I
// did not design it to be one; it fell out of a multiplier compounding against
// six mouths.
//
// So the open question is no longer "is the lottery share small". It is: over
// a FULL RUN, where jackpots have time to arrive and the chain has time to hit
// its cap, do those two lines cross? That is what the unbuilt consumer would
// answer, and it is a better question than the one I started with.
export const SCORE_ORIGIN = {
  bucket: 'aimed',
  heso: 'aimed',
  tulip: 'aimed',
  warp: 'aimed',
  attacker: 'lottery',
  koatari: 'lottery',
  jackpot: 'lottery'
}

/** A fresh provenance ledger. */
export function newProvenance () {
  return { bySource: {}, byOrigin: { aimed: 0, lottery: 0 }, base: 0, fromChain: 0 }
}

// ── the floors ──────────────────────────────────────────────────────────────
//
// QUOTA_BASE and QUOTA_GROWTH are the wall. BALLS_BASE is the clock.
//
// Both were set by measurement — see tools/run-sim.js — and both are
// deliberately stated as two numbers rather than a table, because a table would
// let a future builder flatten a floor to fix a difficulty complaint and hide
// the shape of the curve while doing it. If floor 4 is wrong, the ratio is
// wrong, and the ratio is one number.
export const QUOTA_BASE = 3700
export const QUOTA_GROWTH = 1.30
export const BALLS_BASE = 160
export const FLOORS = 12          // survive twelve and the run is CLEARED

/** The quota for a floor (1-indexed), after any relief the loadout carries. */
export function quotaFor (floor, L, difficulty = 1) {
  const raw = QUOTA_BASE * Math.pow(QUOTA_GROWTH, floor - 1) * difficulty
  return Math.round(raw * (1 - (L ? L.quotaRelief : 0)))
}

/** The ball allowance for a floor. */
export function ballsFor (floor, L) {
  return BALLS_BASE + (L ? L.ballBonus : 0)
}

/**
 * How many parts the back room hands you after clearing a floor.
 *
 * ── THIS IS THE FUNCTION THAT MAKES THE CURVE CROSS ─────────────────────────
 *
 * One part per floor does not work, and it took measuring to see why. A single
 * part is worth roughly ×1.25 of scoring power; the wall grows ×1.40. A player
 * taking one part a floor therefore falls further behind every single floor,
 * forever, and the measured run bore that out exactly — cost-to-clear climbing
 * 66% → 82% → 85% → 93% and the run dead by floor 5, every time, with no
 * crossover possible at any quota base. Lowering the growth ratio does not fix
 * it either; it just moves where the two parallel lines sit.
 *
 * A crossover needs the player's curve to be a different SHAPE from the wall's,
 * not merely a different slope. Picks rising with depth does that: the wall is
 * geometric in the floor number, and the player's power becomes geometric in
 * the CUMULATIVE pick count, which is quadratic in the floor number. Quadratic
 * exponent beats linear exponent, always, eventually — and "eventually" is
 * tunable to land exactly where it should.
 *
 * Floors 1–2 give one part, and they are the hard ones. 3–5 give two, and the
 * run starts to breathe. From 6 the back room hands over three at a time and
 * the machine comes apart in your favour. That is the operator's brief, stated
 * as a function.
 */
export function picksFor (floor) {
  return Math.min(3, 1 + Math.floor(floor / 3))
}

/** Ceiling on parts bought with surplus score, on top of `picksFor`. */
export const MAX_SURPLUS_PICKS = 3

export class Run {
  /**
   * @param cabinet  a cabinet definition from cabinets.js
   * @param seed     the run's seed — offers and floors are reproducible from it
   */
  constructor (cabinet, seed = 1) {
    this.cabinet = cabinet
    this.seed = seed
    this.rng = makeRng(seed ^ 0x9e3779b9)
    this.loadout = resolveLoadout(cabinet.parts || [])

    this.floor = 1
    this.score = 0
    this.quota = quotaFor(1, this.loadout, cabinet.difficulty || 1)
    this.ballsLeft = ballsFor(1, this.loadout)
    this.ballsAtStart = this.ballsLeft

    // The chain. `chain` counts scoring events inside the window of the last
    // one; `chainT` is how long since the last. A chain is the only number in
    // the game that rewards having many balls in flight at once — which is
    // exactly what the fire-rate settings buy, and the reason ARCADE is the
    // default rather than the legal REGULATION.
    this.chain = 0
    this.bestChain = 0
    this.chainT = 0

    this.status = 'playing'     // playing | decision | cleared | failed
    this.cleared = false        // has floor 12 been beaten? banked, permanent
    this.metQuota = false       // this floor's quota has been met at least once
    this.banked = 0             // balls carried into the next floor
    this.offers = null          // the current draft, or null
    this.picksLeft = 0          // parts still to take from this floor's back room
    this.floorScore = 0
    this.totalEvents = 0
    this.launched = 0
    this.launchedAtQuota = 0
    this.inFlight = 0
    this.refundPool = 0
    // The keystone's ledger. Accumulated for the whole run, never reset per
    // floor, and read by nothing. See SCORE_ORIGIN above.
    this.provenance = newProvenance()
    this.events = []
  }

  emit (type, data = {}) { this.events.push({ type, ...data }) }
  drain () { const e = this.events; this.events = []; return e }

  get mult () { return chainMult(this.chain, this.loadout) }
  get progress () { return this.quota > 0 ? Math.min(1, this.floorScore / this.quota) : 1 }
  get chainLeft () { return Math.max(0, this.loadout.comboWindow - this.chainT) }

  /**
   * Score one event.
   *
   * The chain is incremented BEFORE the multiplier is read, so the first
   * scoring ball of a chain is worth ×1.1 rather than ×1.0. That is a real
   * choice and it is the Peggle one: the reward for starting a chain arrives on
   * the ball that started it, not on the next one. Delayed credit reads as the
   * machine withholding.
   */
  add (base, kind, x = 0, y = 0, site = null) {
    if (this.status !== 'playing') return 0
    const L = this.loadout
    this.chain++
    this.chainT = 0
    if (this.chain > this.bestChain) this.bestChain = this.chain
    const kindMult = kind === 'bucket' ? L.bucketScore : kind === 'heso' ? L.hesoScore : 1
    const n = Math.round(base * kindMult * L.scoreMult * this.mult)
    this.score += n
    this.floorScore += n
    this.totalEvents++

    // ── the keystone's ledger ──
    // `flat` is what this event would have scored with no chain running, so
    // `n - flat` is exactly the part of it that the chain paid for. Rounding
    // both from the same quantity is what makes base + fromChain === score
    // hold exactly rather than approximately, which a test pins.
    const P = this.provenance
    const flat = Math.round(base * kindMult * L.scoreMult)
    P.bySource[kind] = (P.bySource[kind] || 0) + n
    P.byOrigin[SCORE_ORIGIN[kind] || 'aimed'] += n
    P.base += flat
    P.fromChain += n - flat
    this.emit('score', { n, kind, site, x, y, chain: this.chain, mult: this.mult, total: this.floorScore })
    // Meeting the quota does not end the floor. It opens a decision — see
    // meetQuota() — and only the first time, because the score keeps climbing
    // afterwards if the player chooses to push on.
    if (this.floorScore >= this.quota && !this.metQuota) this.meetQuota()
    return n
  }

  // ── THE DECISION ──────────────────────────────────────────────────────────
  //
  // The floor's real question, and it only exists because balls are a clock
  // and points are a currency:
  //
  //   PUSH ON — keep firing into a floor you have already beaten. Every ball
  //             spent past the quota is surplus score, and surplus BUYS PARTS.
  //   BANK    — stop now and carry the rest of the tray into the next floor.
  //
  // Neither is right. Parts compound, so an extra part early is worth more
  // than an extra part late; balls are a hedge against a floor going badly,
  // and the floors get harder. A player who always banks is under-built by
  // floor 6; a player who always pushes has no margin the first time the board
  // does not cooperate.
  //
  // This is also why the old leftover bonus is GONE. It paid score for unspent
  // balls, which meant balls were worth score AND balls at the same time —
  // there was no trade, just a number that went up either way. A ball is now
  // worth exactly one of the two things, and the player picks which.

  /** The quota is met. Stop the launcher and ask. */
  meetQuota () {
    this.metQuota = true
    // What the quota COST, frozen here. Once the decision exists, launches
    // spent after this point are a policy choice rather than a measure of how
    // hard the floor was — a player who pushes on spends the whole tray by
    // definition, so cost-at-floor-end stopped meaning anything the moment
    // PUSH ON existed. tools/run-sim.js reads this instead.
    this.launchedAtQuota = this.launched
    this.status = 'decision'
    this.emit('quotaMet', {
      floor: this.floor,
      score: this.floorScore,
      quota: this.quota,
      ballsLeft: this.ballsLeft,
      picks: this.picksEarned(),
      nextPickAt: this.nextPickAt()
    })
  }

  /**
   * Parts earned for this floor: a base by depth, plus surplus.
   *
   * The base (`picksFor`) is what the difficulty curve was measured against and
   * must not move — it is the mechanism that makes the two curves cross at all.
   * Surplus picks are ON TOP, and they double: 2× the quota buys one extra part,
   * 4× buys two, 8× buys three. Doubling rather than a flat step is what keeps
   * the choice live at every depth — late floors clear on 4% of the tray, so a
   * linear threshold would be met by accident and the decision would evaporate
   * exactly when the player finally has balls to gamble with.
   */
  picksEarned () {
    return picksFor(this.floor) + this.surplusPicks()
  }

  surplusPicks () {
    if (this.quota <= 0) return 0
    const ratio = this.floorScore / this.quota
    if (ratio < 2) return 0
    return Math.min(MAX_SURPLUS_PICKS, Math.floor(Math.log2(ratio)))
  }

  /** The score at which one more part is earned — printed, so the bet is legible. */
  nextPickAt () {
    const n = this.surplusPicks()
    if (n >= MAX_SURPLUS_PICKS) return null
    return Math.ceil(this.quota * Math.pow(2, n + 1))
  }

  /** Keep firing into a floor already won. Surplus buys parts. */
  pushOn () {
    if (this.status !== 'decision') return false
    this.status = 'playing'
    this.emit('pushOn', { floor: this.floor, ballsLeft: this.ballsLeft })
    return true
  }

  /**
   * Stop now; the rest of the tray carries into the next floor.
   *
   * ── WHY THE CARRY IS CAPPED ─────────────────────────────────────────────
   *
   * At one full tray, and it has to be. Uncapped, the carry is a geometric
   * series that converges on a fixed point: a floor cleared on 4% of the tray
   * hands 96% of it forward, so `next = BALLS_BASE + 0.96 × prev` settles
   * somewhere near four THOUSAND balls. At the arcade fire rate that is a
   * thirteen-minute floor — for the player, and for the instrument, which
   * simply stopped finishing.
   *
   * A ceiling of one base tray means the best possible bank doubles your
   * allowance and no more. That keeps the decision worth making (doubling a
   * floor's clock is enormous) while keeping a floor a thing that ends.
   */
  bank () {
    if (this.status !== 'decision') return false
    this.banked = Math.min(Math.max(0, this.ballsLeft), BALLS_BASE)
    this.clearFloor()
    return true
  }

  /**
   * Watch a frame of the machine.
   *
   * Takes the events the shell already drained rather than draining them
   * itself — two consumers cannot both drain the same queue, and the shell got
   * there first.
   *
   * ── THE CLOCK IS LAUNCHES, NOT THE TRAY ─────────────────────────────────
   *
   * An earlier build read `ballsLeft` straight off the machine's token balance,
   * on the reasonable-sounding grounds that the machine already maintains that
   * number correctly. It does. It just does not maintain the number this needs.
   *
   * A pachinko tray refills constantly out of the machine's own pockets, and
   * wiring that to the floor's clock meant a good board out-earned its own
   * launcher: measured, floor 8 was taking 746% of its stated allowance to
   * clear, so a "160-ball floor" was really a twelve-hundred-ball grind and the
   * word "allowance" on the HUD was a lie. Balls have to be a clock or they are
   * nothing.
   *
   * So the clock is LAUNCHES. A shot spends one; a foul refunds one, because
   * the machine refunded the token too and the run must not charge for a shot
   * that never entered play. Payouts do not touch it at all — unless the player
   * has fitted BALL RETURN, which connects the tray back to the clock a quarter
   * at a time and, at full stack, hands them the runaway on purpose.
   */
  observe (events, dt, { inFlight = 0 } = {}) {
    if (this.status !== 'playing') return
    this.inFlight = inFlight
    for (const ev of events) {
      switch (ev.type) {
        case 'bucket': this.add(SCORE.bucket * (ev.value || 1), 'bucket', ev.x, ev.y, ev.site); break
        case 'heso': this.add(SCORE.heso, 'heso', ev.x, ev.y); break
        case 'tulip': this.add(SCORE.tulip, 'tulip', ev.x, ev.y); break
        case 'attacker': this.add(SCORE.attacker, 'attacker', ev.x, ev.y); break
        case 'warp': this.add(SCORE.warp, 'warp', ev.x, ev.y); break
        case 'koatari': this.add(SCORE.koatari, 'koatari', 0.220, 0.230); break
        case 'jackpot': this.add(SCORE.jackpot, 'jackpot', 0.220, 0.230); break
        // The clock.
        case 'launch': this.launched++; this.ballsLeft--; break
        case 'foul': this.ballsLeft++; break
        case 'pay': {
          // Fractional, accumulated, and only ever spent in whole balls — a
          // quarter of a launch is not a thing the launcher can do.
          if (this.loadout.ballRefund > 0) {
            this.refundPool += ev.n * this.loadout.ballRefund
            while (this.refundPool >= 1) { this.refundPool--; this.ballsLeft++ }
          }
          break
        }
      }
    }

    // The chain decays on a clock, not on a drain. A ball draining is not a
    // failure — most balls drain, that is the game — so punishing the drain
    // would make the chain a measure of luck. Punishing SILENCE makes it a
    // measure of how much of the board you have alive at once, which is the
    // thing worth rewarding.
    this.chainT += dt
    if (this.chain > 0 && this.chainT > this.loadout.comboWindow) {
      const had = this.chain
      this.chain = 0
      this.emit('chainEnd', { chain: had })
    }

    // The floor is over when the tray is empty AND the board has settled. A
    // ball still bouncing can still find a bucket, and ending the floor while
    // one is in the air would be the machine cutting the player off mid-shot.
    if (this.status === 'playing' && this.ballsLeft <= 0 && inFlight === 0) this.fail()
  }

  clearFloor () {
    this.status = 'cleared'
    this.picksLeft = this.picksEarned()
    this.emit('floorCleared', {
      floor: this.floor,
      score: this.floorScore,
      quota: this.quota,
      over: this.floorScore - this.quota,
      ratio: this.quota > 0 ? this.floorScore / this.quota : 1,
      banked: this.banked,
      picks: this.picksLeft,
      basePicks: picksFor(this.floor),
      surplusPicks: this.surplusPicks()
    })
    this.deal()
  }

  /** Lay out a fresh set of offers for the current pick. */
  deal () {
    this.offers = drawOffers(this.loadout, this.rng, 3)
    this.emit('draft', {
      offers: this.offers.map(o => o.id),
      picksLeft: this.picksLeft,
      floor: this.floor
    })
  }

  /**
   * Take one of the offered parts.
   *
   * Descends only when the picks for this floor are used up — from floor 4 the
   * back room deals twice, and from floor 7 three times, each from a freshly
   * drawn set. Re-dealing rather than letting the player take three from one
   * spread matters: a single spread of three would make the extra picks a
   * discount on the same decision, while a fresh deal is a fresh decision.
   */
  take (partId) {
    if (this.status !== 'cleared') return false
    if (this.offers && !this.offers.some(o => o.id === partId)) return false
    resolveLoadout([partId], this.loadout)
    this.emit('fitted', { part: partId })
    this.picksLeft--
    if (this.picksLeft > 0) { this.deal(); return true }
    this.offers = null
    this.next()
    return true
  }

  /**
   * Decline. Legal, occasionally correct, and always the player's.
   *
   * Declining forfeits the WHOLE floor's remaining picks rather than just this
   * one, because otherwise "skip" is a free re-roll and the draft stops being a
   * decision. A player who wants none of three is telling the machine they are
   * done shopping.
   */
  skip () {
    if (this.status !== 'cleared') return false
    this.picksLeft = 0
    this.offers = null
    this.next()
    return true
  }

  /**
   * Descend.
   *
   * ── WHY CLEARING FLOOR 12 DOES NOT END THE RUN ──────────────────────────
   *
   * It used to. Then the ladder was measured, and from the third cabinet on the
   * auto-player cleared 8 runs out of 8 — meaning the last third of the game
   * had no failure state, and the win screen arrived exactly when the machine
   * had finally become interesting. The whole point of the parts compounding is
   * that the board comes apart in your favour; stopping there is stopping at
   * the good bit.
   *
   * So floor 12 BANKS the win — the unlock credit is permanent from that
   * moment, and the player can walk away with it — and the floors keep coming.
   * OVERTIME has no ceiling: the quota goes on multiplying by the same ratio
   * until a floor finally out-runs the board. The run ends the way every other
   * run ends, on a floor you could not clear, and the score you carry out is
   * how far past twelve you got.
   *
   * That is also the honest answer to "absurdly high scores": not a number the
   * designer picked, but the point at which a geometric wall finally catches a
   * quadratic exponent. It always does. It just takes a while.
   */
  next () {
    this.floor++
    if (this.floor > FLOORS && !this.cleared) {
      this.cleared = true
      this.emit('runWon', { score: this.score, floors: FLOORS })
    }
    this.status = 'playing'
    this.floorScore = 0
    this.metQuota = false
    this.quota = quotaFor(this.floor, this.loadout, this.cabinet.difficulty || 1)
    // Banked balls ride along. This is the other half of the trade the player
    // made on the last floor, and it is why they are added to the allowance
    // rather than replacing it — banking is a bonus on top of the floor's own
    // tray, not a substitute for it.
    const carried = this.banked
    this.banked = 0
    this.ballsLeft = ballsFor(this.floor, this.loadout) + carried
    this.ballsAtStart = this.ballsLeft
    this.launched = 0
    this.launchedAtQuota = 0
    this.refundPool = 0
    this.chain = 0
    this.chainT = 0
    this.emit('floorStart', {
      floor: this.floor, quota: this.quota, balls: this.ballsLeft, carried,
      overtime: this.floor > FLOORS
    })
  }

  /**
   * The tray is empty.
   *
   * If the quota was already met, this is not a failure — it is a player who
   * chose to push on and spent everything doing it. They get the floor, and
   * whatever surplus picks the extra balls bought. Without this check, choosing
   * PUSH ON and succeeding at it would end the run.
   */
  fail () {
    if (this.metQuota) { this.banked = 0; this.clearFloor(); return }
    this.status = 'failed'
    this.emit('runFailed', {
      floor: this.floor, score: this.score, cleared: this.cleared,
      short: this.quota - this.floorScore, quota: this.quota
    })
  }
}
