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
// prints all of it. Measured at the current constants (24 runs, thrifty,
// 2026-07-28 FINAL — after the live door, the on-ramp, the lesser verdicts
// with their display seed, and every review fix; earlier tables in this
// file's history were each true of a machine that no longer exists):
//
//     floor  1   99% of the tray to meet the quota, 100% of runs clear it
//     floor  2  131%,  96% clear   ← the wall starts here
//     floor  3  100%, 100%
//     floor  4  154%,  96%
//     floor  5  160%, 100%
//     floor  6   36%   ← crossover
//     floor  7   38%
//     floor 12    1%          22/24 runs won
//
// Floors costing MORE than a full printed tray is not a bug: BALL RETURN
// refunds and the hazure CONSOLATION (which pays the clock — see observe)
// both stretch the allowance, so a floor can spend half again what it
// started with. The shape: floor 1 is an ON-RAMP that nobody dies on but
// most of a tray is spent climbing, floors 2–5 are the CRUNCH, and the
// crossover at 6 is where the parts out-run the wall.
//
// If a retune pushes the crossover past floor 9 the run has become a wall;
// below floor 4 the early game has stopped being hard. Both are regressions
// and both are visible in one command.
//
// Two cautions for whoever retunes:
//
// 1. The cost column measures launches spent when the QUOTA WAS MET
//    (`launchedAtQuota`) against the tray the floor OPENED with, carried
//    balls included — cost-at-floor-end measured the player's policy rather
//    than the board's difficulty. The validity check is that clear rate and
//    crossover must be IDENTICAL across `--push bank|push|thrifty`, because
//    the decision happens strictly after the quota falls. Re-verified under
//    the live door: 79% and floor 6, on all three policies.
//
// 2. The cost PERCENTAGES are policy-dependent even though the difficulty is
//    not: a policy that banks more carries more, and the carry inflates the
//    denominator (floor 2 reads 124% under thrifty, 151% under always-push).
//    An earlier table here said 205% for floor 2 — measured under the old
//    MODAL decision, where thrifty answered once, chose push, and ran the
//    tray dry with nothing carried. Per-step thrifty banks the residual after
//    buying the reachable part, an outcome the modal made impossible, so
//    next-floor trays are systematically bigger. A review pass caught this
//    table describing a tool that no longer existed. Compare cost columns
//    only within one policy, and re-measure after touching the policies.

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
  warp: 15,         // the shortcut itself is worth something, quietly
  sequence: 250     // 順目 — a straight on the reels; operator's band: above a
                    // bucket, below the small win. Pure lottery: you watched
                    // three digits you never touched come out in a row.
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
// base + fromChain === score, exactly, and a test pins that. (In the SANDBOX,
// where score is a wallet and can be spent, the identity reads
// base + fromChain === score + spent — spending moves score to `spent`
// one-for-one and never touches this ledger, which records what was EARNED.
// A second test pins the amended form.)
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
  jackpot: 'lottery',
  sequence: 'lottery'
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

// The first floor is an ON-RAMP (operator's ruling): easy to finish, and
// worth exactly one part — see surplusPicks. The ease is a named factor on
// floor 1 alone rather than a lower base, because the base times the growth
// IS floors 2+ and the crunch there must not move. Measured at 0.50, FINAL
// sweep (24 runs, stock, all 2026-07-28 changes landed): floor 1 clears
// 100% on 99% of the tray — nobody dies on the ramp, and the consolation
// stretching the clock is why the climb takes most of a tray — with the
// crunch on floors 2–5 and the crossover holding at 6. This comment has
// been wrong twice: first as a prediction written before the instrument ran
// (96%/38%), then as a TRUE measurement (92%/56%) that stopped reproducing
// when the lesser verdicts landed behind it the same afternoon. A
// measurement comment is stale the moment any economy change lands after
// it; re-run the tool before trusting this line, and especially before
// editing it.
export const FLOOR1_EASE = 0.50

/** The quota for a floor (1-indexed), after any relief the loadout carries. */
export function quotaFor (floor, L, difficulty = 1) {
  const ease = floor === 1 ? FLOOR1_EASE : 1
  const raw = QUOTA_BASE * Math.pow(QUOTA_GROWTH, floor - 1) * difficulty * ease
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

/** The sandbox shop's shelf prices — see the shop section in Run. */
export const SHOP = { ballBundle: 100, ballPrice: 4000 }

/** The sandbox cabinet: FREE PLAY's run, all scoreboard and no wall. */
export function sandboxCabinet (spec) {
  return { key: 'free', label: 'FREE PLAY', jp: '遊技', spec, difficulty: 1, parts: [], sandbox: true }
}

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

    // SANDBOX (FREE PLAY): same scoreboard, no wall and no clock. The score
    // becomes a WALLET — see the shop section below — which is the operator's
    // ruling for what free play's number should be for. No quota, no floors,
    // no fail state; the machine keeps its own token balance and the T-key
    // conjure stays, because the exhibit's frictionlessness is the exhibit.
    this.sandbox = !!cabinet.sandbox

    this.floor = 1
    this.score = 0
    this.quota = this.sandbox ? 0 : quotaFor(1, this.loadout, cabinet.difficulty || 1)
    this.ballsLeft = ballsFor(1, this.loadout)
    this.ballsAtStart = this.ballsLeft
    this.spent = 0              // sandbox: score traded away at the shop

    // The chain. `chain` counts scoring events inside the window of the last
    // one; `chainT` is how long since the last. A chain is the only number in
    // the game that rewards having many balls in flight at once — which is
    // exactly what the fire-rate settings buy, and the reason ARCADE is the
    // default rather than the legal REGULATION.
    this.chain = 0
    this.bestChain = 0
    this.chainT = 0

    this.status = 'playing'     // playing | cleared | failed
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
    // Meeting the quota does not end the floor, and does not even pause it —
    // see meetQuota(). It fires only the first time; the score keeps climbing
    // afterwards for as long as the player keeps feeding the launcher. A
    // sandbox has no quota to meet (and quota 0 would "meet" on the first
    // point, which is why the guard is on the flag, not the number).
    if (!this.sandbox && this.floorScore >= this.quota && !this.metQuota) this.meetQuota()
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
  // ── the decision is made LIVE, at the launcher ──
  //
  // An earlier build froze the game here: a 'decision' status, a modal screen,
  // two buttons. The operator's ruling was that the flow of play must not
  // stop — and the ruling turned out to be the more honest mechanic, because
  // the freeze had quietly deleted half the choice. Pushing on is not a menu
  // option; it is a thing a player DOES, by continuing to fire. So meeting the
  // quota changes nothing about the floor's motion: the launcher stays hot,
  // the chain keeps running, and `bank()` becomes callable — the one new
  // affordance, a door that is now open. A player who keeps shooting has
  // chosen PUSH ON with their hands; a player who takes the door has banked.
  //
  // This is also why the old leftover bonus is GONE. It paid score for unspent
  // balls, which meant balls were worth score AND balls at the same time —
  // there was no trade, just a number that went up either way. A ball is now
  // worth exactly one of the two things, and the player picks which.

  /** The quota is met. The floor stays live; the door out is now open. */
  meetQuota () {
    this.metQuota = true
    // What the quota COST, frozen here. Launches spent after this point are a
    // policy choice rather than a measure of how hard the floor was — a player
    // who pushes on spends the whole tray by definition, so cost-at-floor-end
    // stopped meaning anything the moment pushing on existed.
    // tools/run-sim.js reads this instead.
    this.launchedAtQuota = this.launched
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
    // Floor 1 pays exactly its base pick, never more (operator's ruling, with
    // FLOOR1_EASE above). An eased quota is trivially doubled, so without
    // this lockout the on-ramp would quietly become the cheapest part vendor
    // in the game and the optimal opening would be grinding the tutorial.
    // The first REAL decision arrives on floor 2, once a part means something.
    if (this.floor === 1) return 0
    if (this.quota <= 0) return 0
    const ratio = this.floorScore / this.quota
    if (ratio < 2) return 0
    return Math.min(MAX_SURPLUS_PICKS, Math.floor(Math.log2(ratio)))
  }

  /** The score at which one more part is earned — printed, so the bet is legible. */
  nextPickAt () {
    // No price on floor 1: the lockout above means there is nothing to buy,
    // and a printed price for a part that can never arrive is a lie the
    // instrument caught — the auto-player pushed floor 1 chasing it, carried
    // less, and floor 2's clear rate fell from 95% to 77% before this guard.
    if (this.floor === 1) return null
    const n = this.surplusPicks()
    if (n >= MAX_SURPLUS_PICKS) return null
    return Math.ceil(this.quota * Math.pow(2, n + 1))
  }

  /**
   * Stop now; the rest of the tray carries into the next floor.
   *
   * Callable at any moment after the quota is met, while the floor is still
   * live — that is the whole decision now. Balls in flight when the door is
   * taken resolve for nothing: they were launched, so the tray already paid
   * for them, and a score after 'cleared' lands on a closed book. That is not
   * a trap, it is the timing being part of the choice — the balls are visible,
   * and a player who cares waits half a second for them to land.
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
    if (this.status !== 'playing' || !this.metQuota) return false
    this.banked = Math.min(Math.max(0, this.ballsLeft), BALLS_BASE)
    this.clearFloor()
    return true
  }

  // ── THE SHOP (sandbox only) ───────────────────────────────────────────────
  //
  // Free play's score is a WALLET (operator's ruling): trade it for parts or
  // for balls. The prices are not invented numbers —
  //
  //   A part costs what the wall grows by: QUOTA_BASE × QUOTA_GROWTH^owned.
  //   The anchor is QUOTA_BASE itself — the curve's base constant, which is
  //   floor 2's quota divided by one growth step, NOT floor 1's quota (the
  //   on-ramp ease halves that; a review caught this prose claiming
  //   otherwise). Each part raises the next's price by the same ratio the
  //   wall climbs, so the sandbox's price curve IS the difficulty curve
  //   wearing a till — anchored where the curve is, not where the tutorial is.
  //
  //   Balls come in bundles of 100 at 4,000. Measured, a stock board earns
  //   ~30 score per ball, so the bundle sells at ~4/3 of what it generates —
  //   a house margin at stock that parts erode and eventually invert. That
  //   inversion is deliberate: a built board buying profitable balls is the
  //   compounding fantasy, and the T key already hands out free tokens, so
  //   the price protects nothing. It exists to make the trade a trade.
  //
  // The Run never touches the Machine (the law): buyBalls() only moves SCORE
  // and emits — the shell hears 'ballsBought' and calls machine.buyTokens,
  // which books them on the machine's own honest ledger line.

  get partPrice () {
    return Math.round(QUOTA_BASE * Math.pow(QUOTA_GROWTH, this.loadout.parts.length))
  }

  /** Lay out the shop's shelf. Callable any time in the sandbox. */
  shopDeal () {
    if (!this.sandbox) return null
    this.offers = drawOffers(this.loadout, this.rng, 3)
    return this.offers
  }

  /**
   * Spend score. The one place the wallet empties; refuses what it cannot pay.
   *
   * ── the keystone's identity, amended ──
   * Spending moves score to `spent` one-for-one, so in a sandbox the
   * provenance identities read: sum(bySource) === byOrigin total ===
   * base + fromChain === score + spent. The unamended `=== score` form the
   * keystone block states holds in every run mode, where nothing can spend —
   * a review caught the sandbox silently falsifying the documented exact
   * identity, and a test now pins the amended one.
   */
  spendScore (n) {
    if (!this.sandbox || n <= 0 || this.score < n) return false
    this.score -= n
    this.spent += n
    return true
  }

  /** Buy a part off the shelf. Deducts, fits, and re-deals. */
  buy (partId) {
    if (!this.sandbox) return false
    if (!this.offers || !this.offers.some(o => o.id === partId)) return false
    const price = this.partPrice
    if (!this.spendScore(price)) return false
    resolveLoadout([partId], this.loadout)
    this.emit('fitted', { part: partId, price })
    this.shopDeal()
    return true
  }

  /** Buy a bundle of balls. The shell grants them on the machine's ledger. */
  buyBalls () {
    if (!this.sandbox) return false
    if (!this.spendScore(SHOP.ballPrice)) return false
    this.emit('ballsBought', { n: SHOP.ballBundle, price: SHOP.ballPrice })
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
        case 'sequence': this.add(SCORE.sequence, 'sequence', 0.220, 0.230); break
        // The clock. A sandbox has none — the machine owns its own balance
        // there, and decrementing a clock nobody reads would march ballsLeft
        // to minus infinity.
        case 'launch': if (!this.sandbox) { this.launched++; this.ballsLeft-- } break
        case 'foul': if (!this.sandbox) this.ballsLeft++; break
        case 'pay': {
          // THE CONSOLATION feeds the clock directly — the ONE payout that
          // does. The clock's law is: launches spend, fouls refund, payouts
          // stay in the tray unless BALL RETURN is fitted. The consolation is
          // kin to the foul refund, not to a pocket payout: it consoles a
          // WASTED LAUNCH (a total miss), so it pays the launch's own
          // currency back. Without this, a run printed 'ハズレ +3', played
          // the cascade, and confiscated the balls on the next tick — a
          // payout no resource the player owned could receive (review
          // finding). It breaks before the refund pool so BALL RETURN cannot
          // double-dip the same pay.
          if (!this.sandbox && ev.source === 'hazure') { this.ballsLeft += ev.n; break }
          // Fractional, accumulated, and only ever spent in whole balls — a
          // quarter of a launch is not a thing the launcher can do.
          if (!this.sandbox && this.loadout.ballRefund > 0) {
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
    // A sandbox never ends — that is what makes it the exhibit.
    if (!this.sandbox && this.status === 'playing' && this.ballsLeft <= 0 && inFlight === 0) this.fail()
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
