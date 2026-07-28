# The Science Ledger

Every number in Pachinkode that claims to come from somewhere, and where it came from.

This file exists because design law **L2** says the science must be a mechanism, not a mood.
A constant with a citation next to it is checkable. A constant without one is a vibe wearing
a lab coat, and this project would rather cut a good-sounding feature than ship one.

Confidence is marked honestly:

- **PRIMARY** — read from the primary source or its statutory text.
- **VERIFIED** — retrieved and read a real source that reports it.
- **PARTIAL** — corroborated across sources, primary not read directly.
- **DESIGN** — a simulation choice, not a finding. No citation claimed.

---

## 1. The ball, the board, the machine

Almost everything physical about a pachinko machine is *written into Japanese law*:
遊技機の認定及び型式の検定等に関する規則 (National Public Safety Commission Rule No. 4 of
1985), appendix 4. These are not estimates.

| Quantity | Value | Where it lives | Confidence |
|---|---|---|---|
| Ball diameter | 11.0 mm, exact | `world.js` `BALL_R` | PRIMARY |
| Ball mass | legal band 5.4–5.7 g | — | PRIMARY |
| Ball mass used | **5.471 g** | `world.js` `BALL_M` | derived, see below |
| Ball material | steel, uniform (solid, not cored) | — | PRIMARY |
| Playfield | must fit a 500 mm square, contain a 300 mm circle | `board.js` `BOARD` | PRIMARY |
| Board-to-glass gap | >13 mm and ≤25 mm | not modelled — see §6 | PRIMARY |
| Nail material | brass, 150–230 HV | `board.js` `NAIL_R` | PRIMARY |
| Nail shank | 1.7–2.0 mm diameter | `board.js` `NAIL_R` = 0.9 mm | PARTIAL |
| Nails per board | reported ~100–500+, no legal count | 107 after wedge cull | PARTIAL |
| Heso (start pocket) nail gap | 11.25–12.50 mm, tuned in 0.25 mm steps | `board.js` `hesoGap` = 12.5 mm | PARTIAL |
| Prize pocket / gate mouth | ≤13 mm | `BOARD.mouthClosed` | PRIMARY |
| Tulip mouth when open | ≤55 mm | `BOARD.mouthTulip` = 50 mm | PRIMARY |
| Attacker mouth when open | >55 mm and ≤135 mm | `BOARD.mouthAttacker` = 70 mm | PRIMARY |
| Launch rate | ≤100 balls per minute | `machine.js` `LAUNCH_INTERVAL` = 0.6 s | PRIMARY |
| Pending queue (保留) | max 4 | `machine.js` `HOLD_MAX` | PRIMARY |
| Attacker open, per jackpot round | ≤30 s | `machine.js` `ROUND_TIME` = 18 s | PRIMARY |
| Max balls per pocket entry | 15 | `SPECS[*].payPerEntry` ≤ 15 | PRIMARY |
| Max balls per jackpot | 1500 (10 rounds × 10 entries × 15) | all specs under it | PRIMARY |
| Kakuhen probability swing | ≤10× | amadeji 5×, standard 10×, loose 5× — all inside the cap | PRIMARY |
| Ball rental ceiling | ¥4/ball since 1978 | HUD honest ledger | PARTIAL |

### The ball mass, derived

The legal band is 5.4–5.7 g, but the physics is narrower than the law. An 11.0 mm sphere has a
volume of 0.69691 cm³. At plain carbon steel's 7.85 g/cm³ that is **5.471 g**. The 5.7 g ceiling
would require 8.18 g/cm³, above any plain steel — it is tolerance headroom for plating and wear,
not a real ball. So the simulation uses the density-derived figure rather than either end of the
legal range.

### Restitution

| Pair | Value | Source |
|---|---|---|
| ball → nail | **0.50** | Sandeep, Senetakis, Cheung, Choi, Wang, Coop & Ng, *Canadian Geotechnical Journal* 58(1):35–48 (2021), DOI 10.1139/cgj-2018-0712. Chrome steel spheres on a brass block at 1.74–2.43 m/s — overlapping pachinko's nail-impact band — measured 0.54, 0.53, 0.52, 0.51. **VERIFIED** |
| ball → board, rail, vane, ball | 0.30, 0.28, 0.40, 0.65 | generic engineering values. **DESIGN** — no pachinko-specific measurement exists and the code says so |

One correction pushes the nail figure below the measured 0.52: the tested spheres were ~2 mm and
restitution falls with sphere diameter.

An earlier version of this file claimed a *second* correction — that the regulation's 150–230 HV
brass is softer than the tested block and so dissipates more. That does not hold up. The paper
characterises its block only by modulus and never reports its hardness, so there is nothing to
compare against; and 150–230 HV is the hard-drawn end of the brass range (annealed is ~65 HV),
which if anything would push restitution the other way. Noted, not applied.

### Muzzle velocity — the weakest number here

No published measurement of a real launcher's muzzle velocity exists. `Machine.speedFor()` spans
2.85–4.20 m/s, derived from the rail climb plus the sliding-to-rolling energy loss. **DESIGN.**
What *is* solid is the shape: the usable band is narrow because the rail eats nearly all the
launch energy, which is why real handles have a small useful arc.

### Nail adjustment is illegal

Bending nails away from the type-certified state is 無承認変更 — unauthorised modification under
Article 9 of the 風営法 — in the severity band that can suspend a licence. Tolerated for decades
under the fiction that nails bend naturally through play; the National Police Agency ended that
in the 2015–16 crackdown and operators have been referred for prosecution since. **PARTIAL.**
Noted at `board.js` `lifeNails` because a future builder implementing nail-bending as a player
verb should know it is a crime, not a feature.

---

## 2. The dopamine engine

### Reward prediction error, and its asymmetry

Dopamine neurons encode the *difference* between received and predicted reward, in the form of a
temporal-difference error — Schultz, Dayan & Montague (1997), *Science* 275(5306), 1593–1599,
"A Neural Substrate of Prediction and Reward". **VERIFIED.**

Timing: phasic activations have latencies under 100 ms and durations under 200 ms — Schultz
(2010), *Behavioral and Brain Functions* 6:24. **VERIFIED.** Implemented as `PHASIC_RISE = 0.09`,
`PHASIC_FALL = 0.20` in `dopamine.js`.

**The asymmetry is the most important thing in this file.** Niv, Duff & Dayan (2005), *BBF* 1:6,
reporting the Schultz-lab data: positive prediction errors appear as firing ~270% above baseline,
negative errors as only ~55% below it, against a low 2–4 Hz baseline. **VERIFIED.** Implemented
as `DA_UP = 2.70`, `DA_DOWN = 0.55`.

The consequence falls out for free and is the entire trap: because the downside is clipped by a
floor and the upside is not, **a run of losses cannot arithmetically cancel a win in this
channel.** The machine is incapable of *feeling* net-negative while it is taking your money. The
honest ledger in the HUD exists because this is true.

### Uncertainty, and an argument left open

Fiorillo, Tobler & Schultz (2003), *Science* 299(5614), 1898–1902, report a sustained ramp during
the cue–reward delay that is maximal at p = 0.5 — an inverted U tracking Bernoulli variance.
**VERIFIED.** Schultz (2010) adds that these risk-related activations have longer latencies
(~1 s), slower time courses, lower peaks, and appear in about a third of neurons — implemented as
`RAMP_LATENCY = 1.0`, `RAMP_WEIGHT = 0.33`.

**The interpretation is contested, and the contest was published back-to-back in the same journal.**

- Fiorillo, Tobler & Schultz (2005), *BBF* 1:7 — the activation is sustained within single trials,
  and TD models are constitutionally blind to risk: they "do not discriminate amongst" a 10%
  chance of $100 and a 100% chance of $10.
- Niv, Duff & Dayan (2005), *BBF* 1:6 — the ramp may be an averaging artifact. Under the firing
  asymmetry above, averaging back-propagating TD errors across trials produces an apparent smooth
  ramp, largest at p = 0.5, with no uncertainty term anywhere in the model.

**Pachinkode implements both and adjudicates neither.** `dopamine.js` carries Fiorillo's explicit
term, because a renderer needs a number now rather than after four thousand trials.
`tools/ramp-experiment.js` carries Niv's model — a tapped delay line of states from cue to
outcome, plain TD(0), no uncertainty term anywhere, read out through the measured firing
asymmetry — and runs the averaging experiment.

**Result, at 6000 trials per condition:**

| p | delay-period slope, asymmetric readout | symmetric control |
|---|---|---|
| 0.00 | +0.00000 | +0.00000 |
| 0.25 | +0.00077 | +0.00002 |
| **0.50** | **+0.00098** | +0.00010 |
| 0.75 | +0.00074 | −0.00001 |
| 1.00 | −0.00000 | −0.00000 |

A ramp appears, peaks at maximum uncertainty, and collapses tenfold when the clipping is removed
— in a model that contains no uncertainty term. On this data that is Niv's account: nobody put an
inverted U in, it fell out of the asymmetry.

That is a reproduction of a published argument, not a settlement of it. The point is that the
question is askable inside a video game, and that no one has to take this file's word for it.

**And it has a direct consequence for the design.** This machine's spin wins with p = 1/99 =
0.0101, which sits at the *flat* end of that curve — near-zero uncertainty, nothing to ramp on.
The spin is a near-certain loss dressed as a contest. The uncertainty worth feeling is in the
**ball**, above the life nails, with 0.75 mm of clearance per side. That is why the anticipation
in Pachinkode is attached to steel falling through brass rather than to reels.

### Where the uncertainty actually is

The spin is ~1/99 — nearly certain, and nearly certain outcomes carry no ramp. The uncertainty
worth ramping on in pachinko is the **ball's**: directly above the life nails a ball genuinely is
near a coin flip. `Dopamine.uncertaintyAt()` measures this from the machine's own outcome history
rather than asserting it.

And it lands in the same place as the physics. See §4.

### The near-miss

Clark, Lawrence, Astley-Jones & Gray (2009), *Neuron* 61(3), 481–490. **VERIFIED.**

- Near-misses were rated significantly **less pleasant** (t₃₉ = −2.75, p = .009) and significantly
  **more motivating** (t₃₉ = +2.66, p = .011) than full misses. Valence and motivation come apart;
  that dissociation *is* the finding.
- It is **gated on agency**: the effect appeared only on participant-chosen trials
  (interaction F₂,₇₈ = 6.50, p = .002). Computer-chosen near-misses *reduced* the desire to play.
- Near-misses recruited bilateral ventral putamen and right anterior insula — win circuitry,
  despite being losses.

Implemented as `Dopamine.nearMiss(chose)`, which moves `valence` down and `motivation` up
simultaneously. The HUD shows them as separate needles so the player can watch them diverge. The
`chose` parameter is real, not decoration: in Pachinkode the player always chose, because they set
the dial that put the ball in. That is why a pachinko handle is worth having.

Honest caveat: Chase & Clark (2010), *J. Neuroscience* 30(18), found the *neural* signature in
regular gamblers but **not** the behavioural one. The near-miss effect is more fragile than its
fame suggests.

### Losses disguised as wins, and the sound that unmasks them

Dixon, Harrigan, Santesso, Graydon, Fugelsang & Collins (2013), *Journal of Gambling Studies*,
n = 96, within-subject sound-on/sound-off. **VERIFIED.**

- Win-paired audio raised skin-conductance response, F(1,84) = 4.597, p = .035.
- Players overestimated their wins by **15% silent, 24% with sound**, F(1,88) = 5.600, p = .020.
- Their machines' jingles ran 1.5 s to 12 s, and "the bigger the win the longer the song."

Dixon, Collins, Harrigan, Graydon & Fugelsang (2015), *J. Gambling Studies* 31(1), n = 157:
attaching a **negative** sound to losses-disguised-as-wins flipped the majority of players back to
categorising them correctly, with accurate win estimates. **VERIFIED.**

**That second study is the VARNISH slider.** Pachinkode contains a real, structural LDW that is
not a contrivance: a heso entry pays 3 balls and costs on average about 30 to obtain. It is a net
loss of roughly 27 balls and the machine throws a party. At full varnish it gets the party; at
varnish 0 it gets a flat, sour tone. Sliding the control runs Dixon 2015 on yourself.

### What was cut

An early draft raised the pitch of the nail impacts as anticipation built, on the reasoning that
rising pitch reads as approach-to-reward. **A literature pass could not find a single
peer-reviewed manipulation of pitch contour in a gambling context.** It is design folklore,
repeated confidently. It was cut.

What the literature *does* support is narrower — win-paired, and duration proportional to
magnitude — and that is exactly what `synth.js` implements and nothing more. The rising scale
would have sounded good. It would also have been a mood wearing a lab coat, which is the specific
failure this project is organised against.

**And the same failure got two more past the door.** An earlier version of this section also
listed "predictable" and "salience scaled with reward size" as established. Neither is in Dixon
et al. (2013): the team deliberately used *unfamiliar* custom sounds, which cuts against
predictability, and salience was never manipulated. An adversarial audit of every claim in this
repository caught them — inside the very sentence congratulating the project for cutting the
pitch contour. Which is about the right amount of humbling, and is why §7 exists.

---

## 3. Colour

Valdez & Mehrabian (1994), *Journal of Experimental Psychology: General* 123(4), 394–409,
"Effects of color on emotions". Standardised regressions on brightness (B) and saturation (S):

```
Pleasure  =  0.69·B  +  0.22·S
Arousal   = −0.31·B  +  0.60·S
Dominance = −0.76·B  +  0.32·S
```

**PARTIAL** — the coefficients were returned identically by independent exact-phrase searches and
match the published abstract, but the primary is paywalled and was not read directly. A future
builder with access should check them and update this line.

Two results in there are counterintuitive and both are load-bearing:

1. **Saturation drives arousal** (+0.60), not brightness.
2. **Brightness *opposes* arousal** (−0.31), while dominating pleasure (+0.69).

So the maximally arousing image is **dark and saturated** — which is, not coincidentally, what
every casino floor looks like.

`palette.js` inverts the equations: the dopamine model produces a target arousal and `solveBS()`
solves for the (B, S) that delivers it. Colour is downstream of the model, never picked by hand.
`test/varnish.test.js` checks the solver reproduces its target and preserves both directions.

One correction is applied on top, and it is documented in the code: the regression is
*standardised*, so "zero arousal" means *average* arousal, not absence of colour — solving
arousal = 0 still returns S ≈ 0.18. Correct for the model, wrong for a control that must mean
"the dopamine layer is gone", so final saturation is scaled by varnish outright.

---

## 4. Where the physics and the neuroscience meet

The best thing in this project is emergent and nobody designed it.

The launch channel's inner wall stops at 250°, a little before the crest. A ball arriving there
stays pinned to the outer wall only if it is going fast enough to need it:

```
v² / R  ≥  g · |sin θ|        →  about 1.38 m/s at 250°
```

Below that it falls inward and rains down the middle of the board. Above it, it stays pinned,
carries all the way round, and comes down the far right. **Two routes, one knob** — which is
exactly what Japanese players call *hidari-uchi* and *migi-uchi*, left-hitting and right-hitting.
That split was not authored into `board.js`. It falls out of v²/R ≥ g sin θ.

### But it is not a hard boundary, and this file said it was

An earlier version of this section, and of the `board.js` header, and of the HUD, all described a
sharp binary. Measured, the right-route share is a smooth climb:

| dial | 0.00 | 0.06 | 0.12 | **0.18** | 0.24 | 0.30 | 0.36 | 0.42 |
|---|---|---|---|---|---|---|---|---|
| right route | 10% | 18% | 31% | **48%** | 64% | 85% | 95% | 99% |

*220 balls per point, `node tools/headless.js --threshold --balls 220`.*

The energy a ball has left at 250° is not set by launch speed alone — it rattles between the
channel walls on the way up, and the surviving energy varies chaotically from shot to shot. The
split is therefore **probabilistic**, and it is fuzzy for an intrinsic reason: the fuzziness is
still there with the launcher fired from rest at its tightest scatter.

Worse, the closed form was being *drawn on the HUD as a tick mark*. Inverting the launch energy
through the rail climb puts even odds at dial 0.55. The machine crosses at 0.19. **The marker was
a third of the dial's travel out of place**, because the closed form ignores everything the ball
loses in the channel. The HUD now shows the measured odds (`ROUTE_ODDS`), regenerated by the tool
and checked against live behaviour by `test/launcher.test.js`.

### The finding is better than the clean version

There is a dial position where you genuinely cannot know which way a ball will go — and it sits
essentially on top of the setting that best feeds the start pocket (measured heso peak: dial
0.20). **Maximum uncertainty and maximum value at the same place on the knob.**

Fiorillo says maximum uncertainty is where the dopamine ramp is largest. The machine says maximum
uncertainty is at dial ≈ 0.19. They point at the same place, and now the HUD marks the place the
machine actually has rather than the place the arithmetic guessed.

### The launcher's rate-dependent scatter — DESIGN, not measured

A shot fired from rest gets a relative standard deviation of 0.35%; one fired flat out gets 2.6%,
via a leaky accumulator over recent shots (`LAUNCH_TAU = 1.2 s`).

The mechanism is plausible: modern machines drive the hammer with a rotary solenoid against a
return spring, and a fresh ball must drop into the cradle and settle before it is struck. At the
legal maximum rate none of the three has fully seated.

**But nobody publishes launcher scatter, and real machines are famously consistent** — precise
aiming at one gap (ぶっこみ狙い) is a recognised skill, which argues real scatter is small. The
*direction* is defensible; the magnitudes are a game-design choice. Marked DESIGN, and it should
stay marked.

### The pull, the fire rates, and the channel jam

**The pull-back-release control is DESIGN** (a real machine's handle is a held rotation, not a
pull), with one honest anchor: `CHARGE_TIME = 1.1 s` and the base-slider scheme exist so that a
quick tap is a repeatable aimed shot — which is what the real skill of ぶっこみ狙い consists of.

**The fire rates.** REGULATION (100/min) is the legal ceiling and the class default — every bare
`Machine`, every tool, every test runs at it. ARCADE (300/min) and STORM (600/min) are the
simulator taking the glass off, opted into by the shell, labeled in the options with the real
rule. Tempo changes; odds, payouts and the ¥4 rental price do not.

**The channel jam is MEASURED, and kept.** At fast cadence and low power, consecutive balls
interact in the launch channel — measured 347 in-channel ball–ball impacts per 200 balls at dial
0.06 / 0.2 s cadence, versus 45 at regulation. Sustained maximum-rate fire at dial 0.20 mills
83% of balls back as fouls; any tap rhythm with ≥ 0.3 s gaps stays at 1–3%; the board is empty
within seconds of easing off. Real machines carry return-ball prevention parts (patents
JP2003033484A, JP2978440B2) that reduce but do not eliminate this; the operator's own 1970s
machine, which predated them, jammed *cumulatively* — every insufficient ball fell back into the
plunger area. The jam stays as a mechanic on that authority. Balls reaped stationary inside the
channel are refunded as fouls, because they never entered play.

**Consequence for the route odds:** `ROUTE_ODDS` are solo-shot measurements. They hold under
rapid fire for dials ≥ ~0.15; below that, under sustained fire, the split is collision-dominated
and no table can honestly describe it — the HUD names the regime instead of quoting numbers
through it.

**The foul readout is measured too.** `FOUL_ODDS` (solo cadence, `--foulcurve`) replaced a
closed-form crest inversion that printed FOUL below power ≈ 0.135 — where measurement says ~99%
of solo shots enter play. The real cliff: 99% at dial 0.00, 53% at 0.03, ~1% by 0.06. Same
failure class as the old 50:50 tick, caught by the same kind of audit.

### The small win — mechanism VERIFIED, numbers DESIGN

小当たり (koatari) — small-bonus outcomes where the attacker opens briefly — are a real feature
of modern machines. The odds used here (1/28 amadeji, 1/45 standard, 1/15 loose) and the window
(one 7 s opening, 4-entry cap) are DESIGN: the first build used a realistic 1.6 s blink and
measurement showed it caught 0.00–0.25 entries at the recommended base — a prize that paid
nothing. Seven seconds is long enough to *react* with the migi-uchi switch, so the small win
teaches the skill the jackpot requires, on a stake small enough to lose. It remains skill-gated:
the measured yield at a left-route base is still ~0. Economy re-measured with `tools/calibrate.js`
after the change; all three specs remain inside their type-test bands.

---

## 5. The Shepard tone

Shepard (1964), "Circularity in Judgments of Relative Pitch", *JASA*; Risset made it continuous.
**VERIFIED as an existing, documented auditory illusion.**

Six sine partials spaced exactly one octave apart glide downward at a constant rate under a
spectral envelope that is a fixed function of frequency. When a partial has fallen a full octave
it has taken the place of the one below it, so the ensemble is unchanged — and the ear, which
tracks the envelope rather than any individual partial, hears a fall that never lands.

**This is not dopamine science and is not dressed as any.** It is an illusion used deliberately
as an illusion, which is why it belongs in this particular game: a machine that appears to be
going somewhere and demonstrably is not. A kakuhen chain feels like a build. It is a Shepard tone
with a token hopper.

Descending rather than ascending on purpose. Ascending is the conventional casino build, and it
would edge back toward the rising-pitch claim cut in §2.

Measured on the real WebAudio graph, rendered offline:

| Property | Measured |
|---|---|
| Partial spacing | 55 / 110 / 220 / 440 / 880 Hz — exactly 1.000 octave |
| Descent rate, every partial | 0.938 octaves/second |
| Spectral centroid slope | **+0.009 octaves/second** |

A hundredfold suppression. Everything falls; nothing arrives. The geometry is factored into the
pure `shepardFrame()` so `test/shepard.test.js` re-checks all of it on every run — octave spacing,
genuine descent, centroid flatness, a silent wrap point, constant total power.

At varnish 0 the illusion is dismantled: one partial descends once and **arrives**. You hear what
the trick was doing.

---

## 6. The audit

Every claim in this repository was extracted and independently fact-checked by a fan-out of
verifiers with web access, instructed to find errors rather than confirm them. 120 claims were
checked and 27 flagged; after collapsing duplicates and false alarms, **17 were real**.

The measured constants held up almost perfectly — every restitution figure, every test statistic,
every regulatory limit was verbatim correct. What did not hold up was the *prose around them*:

- A **code defect** that made three files describe behaviour the build did not produce (the value
  map never learned; see §2 and `test/learning.test.js`).
- A **regulatory fact that does not exist** — the player-facing panel said the ball's *mass* is
  fixed by law. The law fixes the diameter and gives mass as a band. The code and this file both
  had it right; the one place headed WHAT IS REAL was where it was lost.
- A **part name that could not be sourced**. The return wedge at the top right was labelled
  返しゴム. Two research passes over Japanese board-part references found no rubber component by
  that name and no ゴム part at the rail top at all. The physics is measured and load-bearing; the
  name was invented-sounding and is gone.
- **A citation year**, **a misattributed construct** (dark flow is a multiline-slots finding, not
  a pachinko one), **a correction asserted in the wrong direction** (the brass-hardness argument
  above), and **two unsupported claims smuggled into the sentence congratulating this project for
  cutting an unsupported claim**.

None of that was caught by playing the game or by running the tests. It was caught by treating
the documentation as something that could be wrong. A project that cites its sources is not
automatically honest — it is merely *checkable*, and only if somebody checks.

---

## 7. Known gaps

Named so they are invitations rather than omissions.

- **The Z axis.** The regulation guarantees board and glass are flat and parallel, 13–25 mm apart,
  which leaves an 11 mm ball **2–14 mm of out-of-plane freedom** — more than expected. Pachinko is
  "effectively 2D" but the ball really can tilt, ride a nail shoulder, and rattle against the
  glass. Pachinkode is strictly 2D. A shallow third axis would be a real fidelity gain.
- **Valdez & Mehrabian primary.** Paywalled, never read. Coefficients PARTIAL.
- **Ball-to-board restitution.** No measurement exists for steel on pachinko plywood or acrylic.
  Generic value.
- **Muzzle velocity.** Nobody publishes it. Derived.
- **Nail geometry.** Material and hardness are statutory; the 35 mm length and 1.7–2.0 mm shank
  are hobbyist sources.
- **Pachinko has no physics literature.** There is no rigid-body simulation of a real machine, no
  measured ball-landing distribution, no study treating nail geometry as a control variable. The
  one peer-reviewed paper titled *Pachinko* (Akitaya et al., *Computational Geometry* 68, 2018) is
  combinatorics using perfectly inelastic collisions.

  Which means one thing worth saying plainly: **the distribution this simulator produces has never
  been checked against a real machine, because nobody has ever published what a real machine
  produces.** If a future builder gets access to a real board and a high-speed camera, that
  measurement would be genuinely novel — not just for this game.

- **It should not look Gaussian.** The Galton-board literature is clear that a peg array is a
  low-dimensional chaotic system with fractal basin boundaries, not a binomial machine
  (Judd 2007, *Int. J. Bifurcation & Chaos* 17(12); Arai, Harayama, Sunada & Davis 2012,
  *Phys. Rev. E* 86, 056216; Chepelianskii & Shepelyansky 2001, *PRL* 87, 034101). Real nail arrays
  are deliberately asymmetric and the collisions are correlated. **If the landing distribution ever
  comes out clean and Gaussian, the model has become too idealised.** No randomness needs to be
  injected anywhere — the chaos is in the dynamics.
