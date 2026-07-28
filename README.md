# PACHINKODE

**A pachinko machine built to real dimensions, with a switch on its own dopamine engine.**

▶ **[Play it](https://syntaxswine.github.io/pachinkode/)** — no install, no build step, no dependencies.

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
  returns **83.9% ± 15.4%** over eight runs of 24 000 balls. That spread is not sloppiness — it
  is why the regulation constrains variance and not just the mean.

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

Two routes, one knob, and a hard boundary between them — which is precisely what Japanese players
call *hidari-uchi* and *migi-uchi*, left-hitting and right-hitting. That binary is not in the
source. It falls out of the centripetal condition.

And the dial position sitting exactly on that boundary is the one whose outcome is least
predictable. **Maximum uncertainty lives at a findable place on the knob**, and the HUD marks it.
The physics and the dopamine literature turn out to be pointing at the same number.

## Controls

| | |
|---|---|
| Drag on the board | set launch strength (up is harder) |
| Hold, or **Space** | fire |
| **↑ ↓** (with Shift) | fine dial adjustment |
| **V** | toggle varnish |
| **T** | conjure 500 tokens — recorded in the ledger, because a parlour would never tell you |
| **Esc** | title screen |

During a jackpot, crank the dial past the threshold. The attacker is on the right-hand route and
holding a low dial through ōatari throws most of it away — which is exactly what *migi-uchi* means.

## Running it

Everything is vanilla ES modules and canvas 2D. No dependencies, no build.

```bash
node tools/serve.js 8790
```

## The instruments

The verification tools are part of the deliverable, not scaffolding:

```bash
npm test                        # 26 tests: physics, determinism, varnish law, value learning, the Shepard illusion
node tools/board-audit.js       # find ball traps in the geometry before they find your statistics
node tools/calibrate.js         # measure RTP against the real regulatory bands
node tools/headless.js --sweep  # dial sweep: where every ball ends up, per dial position
node tools/headless.js --threshold   # locate the route boundary, check it against the closed form
node tools/ramp-experiment.js   # run the Fiorillo/Niv dopamine argument on this machine
```

`board-audit.js` earned its place. A pachinko board's characteristic failure is the **wedge** —
two surfaces whose clear span is wider than nothing and narrower than a ball. Every ball that
enters one stops there forever. Three separate instances were hand-chased during construction
before it became clear the problem wanted a rule instead of a fix.

## For the next builder

**[docs/HANDOFF.md](docs/HANDOFF.md)** — where things stand, what is deliberately unfinished, and
the keystone.

**[docs/PLAN-THE-HONEST-MACHINE-2026-07-27.md](docs/PLAN-THE-HONEST-MACHINE-2026-07-27.md)** — the
founding plan and the six design laws. Law 4 (varnish is presentation only) is enforced by test;
if you reach from the renderer back into the simulation, `npm test` will tell you.

---

*The machine is a mirror with a coin slot. Build the mirror properly and the coin slot tells on
itself.*

MIT.
