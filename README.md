# PACHINKODE

**A pachinko machine built to real dimensions, with a switch on its own dopamine engine — and
twelve floors of it to get through.**

▶ **[Play it](https://syntaxswine.github.io/pachinkode/)** — no install, no build step, no dependencies.

---

## The run

Pick a cabinet. Each floor sets a **quota** and hands you a tray of balls; make the quota before
the tray runs out and the **back room** deals you parts — another bucket, wider mouths, a heavier
chain, or the life nails bent another quarter-millimetre past legal. Then the next floor, which
wants thirty per cent more.

Floor 1 is a knife fight: measured, it costs **65% of the tray** to clear. Floor 12 costs **4%**,
because by then the parts have compounded past the wall and the machine is coming apart in your
favour. Clearing twelve **banks the win** and the floors keep coming — OVERTIME has no ceiling,
and the auto-player reaches floor 52 against a billion-point quota before the wall catches up.

Six cabinets unlock as you go, and every one is a real class of Japanese machine: 街台, 一発台,
羽根物, 権利物, デジパチ, and finally 裏物 — the back-room machines with unauthorised ROMs, fitted
with every illegal part this project's documentation spends its time explaining is illegal. That
is the joke the whole ladder walks toward: the power fantasy turns out to be becoming the crooked
operator the honest machine was built to expose.

**FREE PLAY** is still there, unchanged: no quota, no clock, the original exhibit.

---

A pachinko machine gives you exactly one control: a dial that sets how hard an eleven-millimetre
steel ball is fired up a rail. Everything after that is chaos and a random number generator you
never touch.

People play for eleven hours.

The gap between those two facts is closed with **presentation**, and the presentation is applied
neuroscience — well documented, unusually quantitative, and mostly invisible to the person it is
being applied to. Pachinkode builds all of it faithfully, and then puts a switch on it.

The switch is called **VARNISH**. At 100 you get the full machine: saturated colour, metallic
ring, a celebration when a ball finds the start pocket. At 0 you get the same physics, the same
seed, the same odds, the same payouts — in grey, with flat ticks instead of music, and a sour tone
where the fanfare was.

Nothing about the *game* changes. Only the varnish. Slide it mid-session and watch your own
nervous system disagree with the arithmetic.

---

## What is actually real in here

Almost every physical fact about a pachinko machine is written into Japanese law — NPSC Rule No. 4
of 1985, appendix 4 — so these are not estimates:

- The ball is **11.00 mm** and solid steel. Mass is **5.471 g**, derived from the density rather
  than taken from either end of the legal 5.4–5.7 g band, because an 11 mm steel sphere weighs
  what it weighs.
- Nails are **brass at 150–230 HV**. Restitution against them is **0.50**, from published
  measurements of chrome steel on brass at 1.74–2.43 m/s — which is exactly the speed a pachinko
  ball strikes a nail at.
- The gap between the two "life nails" above the start pocket is **12.5 mm** against an 11 mm
  ball. Real boards run 11.25–12.50 mm, adjusted in 0.25 mm steps. That is 0.75 mm of clearance
  per side, and it is the most consequential number on the board.
- Launch rate is capped at **100 balls per minute**, the pending-ball queue at **4**, the
  kakuhen probability swing at **10×**, and a jackpot at **1500 balls**. All regulation.
- The economy is calibrated against the real type-test bands (1 h: 33–220%, 4 h: 40–150%,
  10 h: 50–133%) by `tools/calibrate.js`, which measures rather than asserts. The gentle machine
  returns **124.4%** over four runs of 6 000 balls (the workhorse spec sits at 86.8%, the loose one
  at 91.6%) — all inside the 1-hour band. The gentle figure rose from 82.6% when the roguelike
  added two paying buckets to the stock board, which is a real change to a real economy and is
  reported rather than hidden. That spread is not sloppiness either — it is why the regulation
  constrains variance and not just the mean.

Nothing is scripted. There is no code path that nudges a ball toward a pocket. If it goes in, it
went in.

## What is modelled

- **Reward prediction error, asymmetrically.** Real dopamine neurons fire ~270% above baseline for
  good surprises and only ~55% below it for bad ones. A losing streak therefore *cannot*
  arithmetically cancel a win in that channel. The machine is incapable of feeling net-negative
  while it takes your money — which is why the HUD shows you a truthful ledger next to it.
- **Colour solved, not chosen.** Valdez & Mehrabian's regressions say saturation drives arousal
  (+0.60) and brightness *opposes* it (−0.31). The dopamine model produces a target arousal and
  the palette solves for the brightness/saturation that delivers it.
- **The near-miss, with its agency gate.** Near-misses are rated *less pleasant* and *more
  motivating* at the same time — but only when the player chose the gamble. The HUD shows those as
  two separate needles so you can watch them diverge.
- **A real loss disguised as a win.** A start-pocket entry pays 3 balls and costs about 35 to
  reach. The machine throws a party for a net loss of some thirty. At varnish 0 it gets a sour
  tone instead, which is the Dixon (2015) unmasking manipulation wired to a slider.

Every constant is cited next to itself. **[docs/SCIENCE.md](docs/SCIENCE.md)** is the full ledger,
including what is PRIMARY, what is PARTIAL, and what is honestly just a design choice.

## What was cut

An early draft raised the pitch of the nail impacts as anticipation built, because rising pitch
reads as approach-to-reward. A literature pass could not find a single peer-reviewed manipulation
of pitch contour in a gambling context. It is design folklore repeated confidently, so it was cut.

It would have sounded good. It would also have been a mood wearing a lab coat, which is the exact
failure this project is organised against.

## The thing nobody designed

The launch channel's inner wall stops just before the crest. A ball arriving there stays pinned to
the outer wall only if `v²/R ≥ g·sin θ` — about **1.38 m/s**. Below that it falls inward and rains
down the middle. Above it, it carries all the way round and comes down the far right.

Two routes, one knob — which is precisely what Japanese players call *hidari-uchi* and
*migi-uchi*, left-hitting and right-hitting. That split is not in the source. It falls out of the
centripetal condition.

But it is not a *sharp* boundary, and finding that out was the better result. Measured, the
right-route share climbs smoothly from 10% at dial 0 to 99% by 0.42, crossing even odds at **0.19**
— because a ball's surviving energy at the top of the rail depends on how it rattled up the
channel, which varies chaotically shot to shot. So the HUD shows you live odds rather than a
label, and they are measured numbers, not a model.

Which means there is a dial position where you genuinely cannot know which way a ball will go —
and it sits almost exactly on the setting that best feeds the start pocket. **Maximum uncertainty
and maximum value at the same place on the knob.**

## Pull back, let go

The launcher is drawn as a cutaway below the board: press and hold anywhere on the playfield (or
Space) and the hammer draws back from its BASE toward full over about a second; release and it
fires at whatever the pull reached. A quick tap is a shot at BASE — which is what makes rapid
fire aimable: drum the board and every ball leaves at roughly the slider's setting. The route
odds bar sweeps in real time as you pull, so you can watch a shot's fate change while you build it.

**BASE is the handle on the scale** in the cutaway — drag it. It is where taps fire from and
where the hammer rests.

**Firing fast costs accuracy, and then it costs more than accuracy.** A shot from rest scatters
±0.35%; fired flat out, ±2.60%. And at the faster fire rates, a sustained low-power stream
collides with itself in the launch channel — fouled balls fall back into the climbers and mill
the stream down (measured: 83% fouls under maximum-rate mashing at the recommended base, versus
1–3% for any tap rhythm with a breath in it). The jam is physical, it clears within seconds of
easing off, the fouls are refunded, and the HUD names it while it happens. The operator ruled it
a mechanic on the authority of a 1970s machine they owned, on which the same clog was worse.

**Fire rate is a setting.** REGULATION holds the real 100 balls/minute ceiling — the law exists
so ¥400/minute is the fastest a person may lose money at one of these. ARCADE (300/min, the
default) and STORM (600/min) are this simulator taking the glass off: tempo changes, odds and
prices do not, and the ledger keeps counting.

## The lottery pays at three tiers

The start pocket pays 3 balls and buys one spin — the reels above are a **readout of a verdict
reached the instant the ball dropped in**, at odds printed on the frame. A **小当たり small win**
(about 1 in 28 on the gentle machine) opens the attacker for seven seconds, capped at four
entries — long enough to crank the dial right and harvest, which is exactly the *migi-uchi*
switch a real jackpot demands. The small win is the tutorial for the big one, and it is
skill-gated: sit on a left-route base and it pays you nothing, measured. An **ōatari** opens the
attacker for rounds, runs the Shepard descent underneath, and counts itself up on the display.

## Controls

| | |
|---|---|
| **Hold** board or **Space** | pull the hammer back — longer is harder |
| **Release** | fire at the pull you reached |
| **Tap** (or drum with two thumbs) | rapid shots at BASE |
| **Drag the scale** in the cutaway | set BASE |
| **↑ ↓** (with Shift) | fine BASE adjustment |
| **V** | toggle varnish |
| **T** | conjure 500 tokens — recorded in the ledger, because a parlour would never tell you |
| **Esc** | title screen |

During a jackpot — or a small win's seven-second window — crank the dial right. The attacker is
on the right-hand route and holding a low dial through it throws the prize away — which is
exactly what *migi-uchi* means.

## Running it

Everything is vanilla ES modules and canvas 2D. No dependencies, no build.

```bash
node tools/serve.js 8790
```

## The instruments

The verification tools are part of the deliverable, not scaffolding:

```bash
npm test                        # 75 tests: physics, determinism, varnish law, value learning,
                                #   the pull, the fire-rate contracts, the Shepard illusion,
                                #   the two conditioning laws, and the run — including that a
                                #   Run may expose no presentation surface and a Machine may
                                #   expose no run-shaped member at all
node tools/board-audit.js       # find ball traps in the geometry before they find your statistics
node tools/calibrate.js         # measure RTP against the real regulatory bands
node tools/headless.js --sweep  # dial sweep: where every ball ends up, per dial position
node tools/headless.js --threshold   # locate the route boundary, check it against the closed form
node tools/headless.js --foulcurve   # measure the solo-shot foul cliff the topbar reads
node tools/ramp-experiment.js   # run the Fiorillo/Niv dopamine argument on this machine
node tools/loadout-audit.js     # the wedge sweep across EVERY board a run can build (a gate)
node tools/run-sim.js --curve   # play whole runs; print the difficulty curve and its crossover
node tools/run-sim.js --power   # what a part is actually worth, measured
node tools/run-sim.js --sites   # per-bucket entry counts — the real reachability answer
```

`loadout-audit.js` is the one instrument here that is a **gate** rather than a report, and it
earned that on its first run. The board is now a function of the loadout, which means the number
of reachable playfields is the product of every widening step, every bucket count and every
cabinet's starting parts — a player will stand in front of a board no human ever looked at. The
very first sweep found a west bucket's wall converging on the launch rail at 11.1 mm: a permanent
trap, on a board that would have shipped.

`board-audit.js` earned its place. A pachinko board's characteristic failure is the **wedge** —
two surfaces whose clear span is wider than nothing and narrower than a ball. Every ball that
enters one stops there forever. Three separate instances were hand-chased during construction
before it became clear the problem wanted a rule instead of a fix.

## For the next builder

**[docs/HANDOFF.md](docs/HANDOFF.md)** — where things stand, what is deliberately unfinished, and
the two keystones. Both are pre-wired and neither is built, on purpose:

- **Nail bending.** Every nail carries a displacement already summed into collision, broadphase
  and render, and never set to anything but zero. Bend one, and the board's economy moves.
- **The conditioning ledger.** Every sound declares a cue family and stamps itself when it
  sounds; nothing reads the log yet. Wire a consumer and the machine's own conditioning becomes
  measurable — then it can hand you a receipt for it.
- **The run's own seed.** A Run is fully reproducible from one integer — the offers, the floors,
  all of it — and nothing surfaces that integer or lets you type one in. Daily runs and shared
  seeds are one text field away.

The game proves it is honest about your money. It does not yet prove it is honest about what it
taught you. That is the whole of the second keystone.

**[docs/PLAN-THE-HONEST-MACHINE-2026-07-27.md](docs/PLAN-THE-HONEST-MACHINE-2026-07-27.md)** — the
founding plan and the six design laws. Law 4 (varnish is presentation only) is enforced by test;
if you reach from the renderer back into the simulation, `npm test` will tell you.

---

*The machine is a mirror with a coin slot. Build the mirror properly and the coin slot tells on
itself.*

MIT.
