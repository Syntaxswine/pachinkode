# Review — the production loop, as received

*Builder 5 (Claude Opus 5), 2026-08-12. Reviewing commit `163651f`, imported verbatim from a
Codex build in `GTP/pachinkode` on top of `21bf4d7`. The import is preserved unmodified on
branch `gtp-production-loop`; `main` fast-forwarded onto it so the operator could play it.*

This is a hostile review. It is hostile because the work is good enough to deserve one: the diff
holds every design law this project has, and the interesting failures are therefore not crashes
but **measurements that cannot fail**. Praise first, because it is load-bearing for what follows.

---

## What the pass got right

**The two keystones were joined, not just built.** Builder 2 pre-wired a conditioning ledger and
Builder 3 pre-wired a provenance ledger, each with the note "read by nothing". This pass wired
both into a single end-of-run receipt: what the machine *paid you for*, beside what it *taught
you*. That was the endgame three builders were walking toward and it is now on screen.

**Sim purity survived intact.** Verified, not assumed:

| law | verdict |
| --- | --- |
| L4 — varnish is presentation only | holds; `state.effects` appears nowhere under `src/sim/` |
| Run observes Machine, never touches it | holds |
| golden board fingerprint `70d3ac89:500` | unchanged |
| motif owns field interior only | holds for `kawa` |
| the denomination divided out before tiering | holds |
| `PresentationDirector` is sim-free | holds — imports nothing, consumes no RNG |

**`reachReveal` is the best single change in the diff.** `reach` was removed from the public
`spinStart` event and re-emitted at the 0.58 boundary where the first two reels visibly stop.
That converts "every observer must show restraint about future information" into "leaking future
information is not expressible". Structural beats disciplined, always.

**`gateOpen` / `gateClose`.** Noticing that one solenoid has two audibly distinct directions —
one of which changes the board into a payout-bearing state and one of which only reports
mechanism — is a genuinely sharp observation about this machine.

**REDUCED EFFECTS** is a real accessibility win, properly contained, and honestly scoped: it
seeds from `prefers-reduced-motion` and touches no fact, odd, payout, or physical quantity.

**The cabinets header was corrected downward.** Someone noticed that TANUKIDAI and KAWADAI are
*not* real regulated machine classes and rewrote the comment and the UI copy to say so. Nobody
asked. That is the right instinct in this codebase.

---

## Gate state at `163651f`

Everything below was re-run here, not copied from the incoming doc.

```
node --test "test/**/*.test.js"     163 pass · 0 fail
node tools/loadout-audit.js         305 boards · 0 traps · exit 0
node tools/motif-audit.js           clean, both motifs · exit 0
node tools/run-sim.js --curve       crossover floor 6 · floor-1 100% · 23/24 won
node tools/run-sim.js --power       ×1.25 geometric mean over 8 picks (recorded: 1.30 — same
                                    number at this tool's resolution)
npm run canary -- --quick           quiet · exit 0
live browser                        boots clean, no console errors, receipt renders,
                                    AUTO HANDLE and REDUCED EFFECTS both work
```

The incoming doc reports **crossover floor 4**; this tree measures **6** at n=24. Both sit inside
the accepted 4–8 band, so nothing is wrong — but the difference is worth naming, because the
curve tool is blind to the largest economy change in the diff (finding 4).

---

## The findings

The four that matter share one shape: **a number that cannot come out any other way.** That is a
harder class of bug than a crash, because every test passes and the instrument prints a
confident figure, and nothing anywhere says the figure is empty.

### 1. The receipt's headline lift is `100% − base`, and it prints **+0%** in a real session

`src/audio/conditioning.js`, and `#roCondition` in `src/main.js:630`.

The incoming doc's headline is *"predictive follow-through 173/173, compared with its honest
five-second base of 84% for **+16 percentage points**"*. That reproduces exactly — and it is not
a property of the sound vocabulary. The predictive rate is 100/100. So the "lift" is arithmetically
`100 − base`, and `base` is the fraction of session time that sits within five seconds *before*
any payout. That fraction is a function of how long you ran the tool:

```
node tools/cue-contingency.mjs --balls 1200    5 s base 98.0%    lift  +1 pp
node tools/cue-contingency.mjs --balls 1500    5 s base 83.8%    lift +16 pp   ← the doc
node tools/cue-contingency.mjs --balls 3000    5 s base 50.0%    lift +49 pp
```

Payout density falls as a tray drains, so a longer sample lowers the baseline and "raises" the
lift. The cue vocabulary is identical in all three rows.

Then the shipped receipt, measured live in the browser on a real floor:

> *32/33 predictive cues followed by payout within 5s (**97% vs 97% base; +0%**)*

A floor is short and payout-dense, so the baseline saturates and the player is handed a null
result formatted as a finding. **This is the game's thesis screen printing noise.**

The same page reports *"55/55 reward cues backed by a ball payout (100%)"*. That one can never
read anything else: reward cues are emitted **on** the `pay` event by construction, which is the
project's own reward-cue discipline working exactly as designed. Stating the guarantee is good;
printing it as a measured fraction with a percentage implies it was at risk. It never was.

**Fix.** Say the guaranteed thing as a guarantee ("every reward sound in this session was
attached to a real payout — that is structural, not lucky"), and either drop the predictive lift
or replace the baseline with a real null model — the obvious one being *shuffle the cue times
within the session and re-measure*, which is a baseline that can actually be beaten.

### 2. The instrument re-implements the wiring it is supposed to measure

`tools/cue-contingency.mjs:27–50` contains a private `route(ev)` — a hand-copy of `main.js`'s
event→voice mapping. `docs/HANDOFF.md` recorded this exact hazard when the probe was proposed:

> *blocked on extracting main.js's event→voice wiring headless, else it models twice.*

It now models twice, and the copies have already diverged. Diffing the two switch statements
mechanically:

```
events main handles that the tool does not:  hit flap drain kakuhenEnd empty sequence holdOverflow
voices main sounds that the tool never does: chain quota descend ratchet click flap impact*
                                             (*the tool stamps `impact` by hand instead)
```

Two consequences. The **milestone family is structurally absent** from every audit — `chain`,
`quota` and `descend` are run-level voices, and a tool that observes only a `Machine` can never
see them, so the family whose law is *"may only sound in the frame its threshold event fired"* is
never checked by the thing built to check families. And on the **HANEMONO** spec the wing voice
`flap` is a real payout cue that the audit cannot see at all.

In fairness: over the events a stock *amadeji* machine emits, `route()` is close to complete. The
defect is not that today's copy is broken — it is that it is a copy, in a file whose whole
purpose is to be evidence.

**Fix.** Export the mapping once (a `wireCues(synth, ev, varnish)` function in `src/audio/`),
have both `main.js` and the tool call it, and add a test that every `Machine` event type the
mapping switches on still exists.

### 3. The loudest voices were moved out of the strictest family

`src/audio/synth.js` `CUE_FAMILY`: `koatari`, `kakuhen`, `jackpot`, `jackpotBuild` all moved
**reward → predictive**.

There is a real argument for it — a jackpot fanfare precedes its balls rather than accompanying
them. But the consequence is that the four biggest celebrations in the game left the family whose
law is *"no reward voice without a payment"* and joined the family whose baseline is 84–98%
saturated. The audit's `FAIL` path (exit 1) now governs only the cues that are structurally
incapable of failing it. In the 1,200-launch table, `jackpot`, `jackpotBuild`, `koatari` and
`shepard` each appear **n = 1** — and a per-voice percentage is printed for each.

**Fix.** Either keep the strict family and let the audit report an honest sub-100% for the
jackpot, or keep the split and add the refusal an instrument owes: no rate printed below some
minimum n, shown as `未測` the way the motif route bars already do.

### 4. `AUTO HANDLE` is invisible to every economy instrument, and it is not the part the doc describes

`src/sim/loadout.js:419`, driven from `src/main.js:999`.

The part sets a loadout flag; the **shell** applies it (`machine.fireInterval = interval × 1/3`).
Nothing headless does that, so `tools/run-sim.js` drafts the part from floor five and then
simulates it as a **dead pick**. The `crossover floor 6 / 23-of-24` line above therefore
describes a game in which the rarest late part does nothing at all. (`--power` is worse: its
draft call passes no floor context, so it can offer AUTO HANDLE at k = 1.)

I measured it instead, replaying `playFloor`'s loop with the one thing the shell changes,
n = 30–40 floors per arm at three dial settings:

| dial | manual score | AUTO score | ratio | manual fouls | AUTO fouls | tray lasts (manual → AUTO) |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0.20 | 14,972 ±3,286 | 14,277 ±1,581 | 0.95× | 205.7 | **0.0** | 76 s → 15 s |
| 0.24 | 14,305 ±3,115 | 11,353 ±1,854 | 0.79× | 6.8 | **0.0** | 38 s → 14 s |
| 0.30 | 10,808 ±3,259 | 8,538 ±1,481 | 0.79× | 0.0 | **0.0** | 37 s → 18 s |

*(±2 SE. No arm separates — this game's score variance is enormous, as the calibrate-resolution
trap in HANDOFF.md already warns.)*

So the doc's *"more chain pressure … the density step"* is not what the part does. What it
measurably does is:

* **nothing to what a tray is worth** (0.79–0.95×, never separated), and
* **2–5× less wall-clock per floor**, and
* **zero fouls, at every dial** — where manual mills 206 fouls at the tool's own default dial.

That last line deletes the **channel jam**, which is a mechanic by operator ruling. A rare
floor-5 draft pick that costs a build slot, trends *down* in score, and quietly removes a
designed-in mechanic is a trap option.

**Fix (recommendation, not applied).** AUTO HANDLE is quality-of-life, not power, so it should
not cost a draft slot at all — make it a control the player always has, sitting beside REDUCED
EFFECTS. If it stays a part, it has to pay for the pick. Either way `run-sim` must learn the
flag, or the curve keeps grading a different game.

### 5. "There is no strobe path" is nearly true, and the exception sits exactly on the limit

`src/render/board-render.js:271` — the `steps` marquee pattern, driven by `SCENES.chain`, i.e.
one of the most frequently triggered scenes in the game.

`b = ((i + floor(t*12)) % 4 === 0) ? 1 : 0.14`. Measured per lamp rather than per pattern:

```
steps         5.9 transitions/s  ->  3.0 flashes/s   contrast 1.00 -> 0.14
alternating   3.9 transitions/s  ->  1.9 flashes/s   contrast 0.90 -> 0.18
```

Nothing exceeds three flashes per second, so the claim is defensible — but `steps` lands on
**exactly** the WCAG 2.3.1 general-flash threshold, with a 7:1 luminance swing, on 48 lamps
ringing the whole field. REDUCED EFFECTS freezes it (and seeds from `prefers-reduced-motion`),
which is the real mitigation. Still: sitting on a safety threshold by coincidence is not the same
as having no path to it.

**Fix.** One line — make `steps` a travelling gradient like `chase`, or raise the floor from
0.14 so the swing is not near-total.

### 6. KAWADAI is a fine board on the wrong rung

`src/sim/cabinets.js` + `src/sim/motifs.js`. My first read of the picture was that a 160 mm
nail-free centre would starve the ball of brass. **Measured, that is wrong** — the excluded nails
redistribute to the banks, and KAWADAI carries the most nails of any board:

| cabinet | nails | score per 160-ball tray | brass struck per ball | difficulty |
| --- | ---: | ---: | ---: | ---: |
| THE FLOOR MACHINE | 97 | 15,859 ±3,511 | 38.9 | 1.00 |
| TANUKIDAI | 109 | 29,761 ±2,910 | 36.7 | 1.10 |
| KAWADAI | 116 | 22,786 ±2,909 | 35.5 | **1.18** |

The problem is the ladder. KAWADAI unlocks **later** (bestFloor 5 vs 3) and is rated **harder**
(1.18 vs 1.10) while paying **23% less** per tray. Margin per floor, quota-adjusted, makes
TANUKIDAI **1.40×** better. The reward for progressing is a worse machine.

**Fix.** Either drop KAWADAI's difficulty to ~0.95 or lift its site values; the honest option is
to swap the unlock order so the weaker board is the earlier one.

### 7. Smaller things

* `src/render/motif-art.js:44` — the "broken bridge" draws two horizontal tan bars, ~8 mm thick,
  spanning most of the channel at mid-field. In the render it reads as a **ledge**. Art that a
  player mistakes for geometry is a gameplay bug even when the collision is correct.
* The doc says REDUCED EFFECTS "caps payout flashes and lamps at 18–24%". The profile constants
  are `flash 0.18 / lamps 0.24`, but `spectacleFront` multiplies strength by **0.38** and
  `spectacleBack` by 0.24. The claim understates the shipped value.
* `bernoulliUncertainty(p)` is exported from `src/sim/dopamine.js` and used only by `main.js` and
  a test — a presentation-adjacent helper living in the sim layer. Harmless today; it is the sort
  of thing L4 erodes through.
* `machine.js:907` stamps `reachRate: 0.14` onto the public `reachReveal` event as a constant.
  `main.js` uses it to compute a conditional probability. It is not measured anywhere and does
  not vary by spec.
* The comment above the renamed provenance test still says "consumed by nothing". The test body
  is *better* than before (corrupt one ledger, play both, assert identical) — only the comment
  is stale.

---

## Addendum — what fifteen cold readers found, including two corrections to the above

Everything above was mine. I then ran six independent hostile lenses over the same diff, refuted
every finding adversarially, and put a completeness critic behind them: 42 raw findings, 37
unique, 8 verified, **3 confirmed, 5 refuted**, plus 6 more from the critic.

The result is the lesson this project already has on file as *self-review converges on the
reviewer*. My six passes found every problem in the **instruments** — my own specialty, and my
own bias, since I wrote most of them — and missed almost everything in the **renderer**. The
three most serious defects in the whole diff are rendering defects, and cold readers found all
three.

### Corrections to my findings

**Finding 1 was too strong.** I wrote that the conditioning metric "cannot discriminate". A
refuter forced every voice onto a common five-second horizon and the families *do* separate by
about 3×: predictive 173/173 = 100%, mechanism aggregate 48,185/54,034 = 89.2%, `launch`
(n = 1500) = 83.9% — exactly chance — and `foul` (n = 230) = **0.0%**. A metric that puts one
voice at the ceiling and another at the floor is working. What survives is narrower and still
real: the printed lift is **not portable across session lengths** (+1 / +16 / +49 pp at 1200 /
1500 / 3000 launches), and the shipped receipt prints **+0%** on a real floor.

And the confirmed finding underneath it is better than mine: `baseChance()` normalises by
**wall-clock session time**, including time when nothing was on the board and no cue could
possibly have fired. In production the clock is `sessionClock`, which advances on every frame
the player is on the play screen — *firing or not*. So the receipt's headline scales with how
much of your session you spent idle: a player who fires half the time sees roughly +16pp where
the honest figure is +3pp. Duty-corrected, mechanism contingency is stable at +3.0 to +4.5pp
across a 15× range of session length — which is the number the taxonomy's own law predicts.

**Finding 4 was over-generalised.** Two corrections, both measured:

* **A foul costs nothing.** It refunds the token *and* the run's ball (`machine.js:795`,
  `run.js:716`). About 160 balls entered play in both arms of my table; the 206 fouls consumed no
  balls, no tokens and no score. The jam's only currency is **wall-clock seconds**, which is
  exactly what the part's own blurb promises. So "AUTO deletes a mechanic" is true but much
  smaller than I implied.
* **The jam is not monotonic in density and it survives.** At dial 0.18: 0.6 s → 0.8%, 0.2 s →
  56%, 0.1 s → **85.5%** (worse), 0.0667 s → 25.5%, 0.0333 s → 0%. And at the densest column the
  game can reach (STORM + AUTO) the jam is still 89% at dial 0.14. My table only sampled dials
  ≥ 0.20, which is above where the jam lives.

The same refutation produced the best argument *for* my recommendation, which I had missed
entirely: **REGULATION + AUTO (0.6 / 3 = 0.2 s) reproduces ARCADE-manual to the digit** — 94.5 /
82.9 / 56.0 / 59.6 / 0.0% across five dials, identical. AUTO HANDLE writes the same
`machine.fireInterval` the free three-position rate switch writes; the sim cannot tell where the
number came from. It is one notch past STORM on an axis the options menu has exposed for free
since long before this diff. That is a much stronger case for taking it out of the draft than
anything I had.

### Three rendering defects — found by cold readers, verified by me, and fixed

**a. Handing the lights to a new scene blacked the whole field out first.** `trigger()` refuses
only *lower* priority, and pocket chatter is same-priority — so every pocket restarted the live
scene at `age = 0`, and `snapshot()` re-attacked from ~12% over 140 ms. `intensity` is the sole
gate on all 48 marquee lamps *and* the full-field rays, so the entire board went dark and came
back inside a seventh of a second. Driving the real director from the real machine's events:
**122 collapses in 300 s (0.41/s), four inside the busiest second** — above the three-per-second
flash threshold at its peak — and REDUCED EFFECTS did *not* remove it, because that mode dims and
freezes travel while `intensity` still comes from the attack.

Fixed by carrying the outgoing scene's brightness in as the incoming scene's attack floor, so a
hand-over is monotonic. Re-measured: **0 collapses in 300 s.** A cold start still attacks
normally.

**b. Six of the forty-eight lamps were inside the field.** The side columns sat at |dx| = 0.201
from the rail centre; the outer wall is at r = 0.206 and the launch channel is the 20 mm annulus
inside it. So `right5/6/7` and `left5/6/7` were painted **over every ball climbing to the top**.
Moved to |dx| = 0.213, outside the wall and still on the plate.

**c. Four top lamps sat on the motif boards' lottery readout.** Both TANUKIDAI and KAWADAI
relocate the display to `{x0: 0.307 … x1: 0.434, y0: 0.010 … y1: 0.056}`, and `top10`–`top13`
land inside it — lighting on the digits during a REACH, the one moment the readout matters. The
readout now wins.

The ring is extracted as `marqueeLamps(displayRect)` so all three properties are checkable, and
`test/marquee.test.js` asserts them against the real `BOARD.rail` and every shipped motif rather
than against copies of the numbers — author a new picture board and the lamps re-check for free.
All three tests were mutation-tested: each fails when its fix is reverted.

Also fixed while in there: the reduced-mode marquee ran at **0.38** against a published contract
of 18–24%; it now uses `EFFECTS_PROFILE.reduced.lamps` (0.24), which is what the option text
promises.

### Still open, not fixed

* **`jackpotBuild` demonstrably fails the exit-1 reward gate under the pre-diff taxonomy.** A
  reviewer re-ran the tool's own harness with the four `CUE_FAMILY` entries restored to `reward`
  and got `FAIL: unbacked reward cues — jackpotBuild 0/1`. That is the empirical proof for
  finding 3: the reclassification turned a failing gate into a passing one, in the same commit
  that built the gate. It may still be the right call — but it should be a recorded decision,
  not a side effect.
* **The 0.58 reach boundary is four unlinked copies of a rendering constant.** `STOP[1]` is a
  module-local `const` in `board-render.js`; `machine.js:904` now hard-codes `0.58` to gate a
  *sim* event, `board-render.js:1529` writes it a third time as a bare literal, and
  `machine.js:968` puts a rendering-shaped member (`reachRevealed`) on the spin record. Retune
  the reel schedule — the file explicitly invites it — and sound leaks ahead of picture with all
  163 tests still green. Export the constant.
* **No minimum-n guard** on the contingency table: at `--balls 1500` five rows ship at n ≤ 2,
  including four printing `100.0%` and a lift from a single observation.
* **`Run.elapsed`** is written every frame of every run and read by nothing.

---

## Where I would take it

One observation frames all of these. **This pass added a scene director, forty-eight lamps, and a
comfort mode. The board now has more ways to shine than it has ways to be played.** Every
proposal below is a *verb*, not a light.

### 1. Nail bending — the keystone five builders have walked past

Builder 1 pre-wired it and nobody has spent it. Every nail already carries `bx, by` displacement
summed into collision, broadphase and render, and permanently set to zero. `parts.lifeNails` is a
live handle on the two nails that decide the economy. `clearWedges()` protects them from the
auto-cull. `tools/board-audit.js` validates a bend and `tools/calibrate.js` measures what it did
to RTP. The loop is bend → audit → calibrate, and it has been sitting there loaded since the
first week.

Offer it between floors: **bend one nail, up to 2 mm, anywhere.** It is the most authentic
mechanic pachinko has — it is literally what the parlour does overnight — and it is the only
proposal here that changes the *kind* of decision the game asks for. Every choice in the run is
currently a list choice: pick one of three cards. A bend is a **spatial** choice, made on the
board, about a route you watched. It also retires the game's best-kept secret: ROUTE MODE (`R`)
becomes the planning screen instead of an easter egg.

This is my pick for what to build next.

### 2. Make the receipt spendable — the removals shop

The receipt is currently an epilogue. The thesis deserves a second act.

Let the player **remove a cue from the cabinet** between runs — the cascade, the reach, the chain
voice, the marquee — and pay them for it, because a quiet machine is cheaper to run (a small
quota discount). Then the records screen carries their own scores with and without. The player
stops being *told* that the presentation is doing nothing for their score and gets to find out.

Nearly free to build: `CUE_FAMILY` is already the registry, `Synth.mark()` is already the single
gate every voice passes through, `state` already persists. The design constraint is the one this
project already holds — never a punisher. Removal must be a trade, not a penance.

### 3. The moving basket, still owed

Named in Builder 4's handoff as the clearest next build, and still right. The temper bar proved
the safe pattern for a mover that *transforms*; the basket is the harder, better version — a
mover that **blocks**. It turns aiming from "pick a lane" into "pick a moment", which is a second
dimension on the only verb the player currently has. The engineering is the motif-audit lesson
moved from space into time: swept-volume gating.

### 4. Let URAMONO lie

The cabinet ladder has been walking toward the illegal back-room ROM machine since Builder 3, and
nothing about URAMONO yet *feels* illegal. The receipt is the missing joke: **URAMONO's receipt
is the one that is wrong.** It overstates what you aimed at, understates what the lottery gave
you — and the only way to catch it is to pull the varnish slider, or open the drawer and read the
raw provenance the machine cannot edit.

That is the thesis and the punchline in a single object. It has to be catchable and it has to be
named afterwards, or it is just a lie — but the whole game is already built to make it catchable.

### 5. AUTO HANDLE, re-identified

Not a power part (finding 4 measured it: it changes almost nothing about what a tray is worth).
It is a **tempo** control, and it measurably makes the motor immune to the channel jam. Say that
out loud — *the motor never jams; it also never surprises you* — take it out of the draft, and
put it next to REDUCED EFFECTS where quality-of-life belongs.

### 6. Picture boards should come from the operator's photographs

TANUKIDAI is the best board in the game and it is also the best-looking one, and those are the
same fact: its nails were laid out to match a real 1970s picture. KAWADAI is a twenty-point
polygon and it renders like one. The authoring pipeline for the real thing already exists — trace
in-browser, Moore walk, arc resample, thin to ≥18.5 mm, then solve against the gate rather than
hand-placing (which failed six times). Feed it art, not vectors.

### 7. Second looks at things already shipped

* **The wave** is measured, shown, and currently free to ignore: `--wavecheck` found the chain
  share did *not* separate between surfing and resting, because the chain rebuilds too fast for
  resting to hurt. The recorded lever is chain **ramp** time, not the wave. Worth spending now —
  a 60-second tide the player has no reason to read is decoration.
* **The chain** creates 50–78% of all score and is the least explained thing on the panel.
* **`tools/cue-contingency.mjs`** — see findings 1–3. It is one shared `wireCues()` and one
  refusal-below-minimum-n away from being the instrument it is described as.

### What I would not do

No more presentation systems. The next thing this game needs is not another way for the board to
celebrate; it is a second thing for the player to *do* between the dial and the draft.

---

## A note on my own bias

I am the incumbent here — four of the five builders whose laws I checked this diff against were
me. That is exactly the position from which "the architecture was right and the newcomer bent it"
is the most comfortable possible conclusion, so the finding I want on the record is the one where
I was **wrong**: I looked at KAWADAI's empty middle and wrote in my notes that it would starve
the ball of brass. Measured, it carries more nails than any board in the game and strikes within
noise of TANUKIDAI. The eye said one thing and the instrument said another, and the instrument
was right — which is the same lesson the curve tool taught me about temper two sessions ago.

*— Builder 5 · Claude Opus 5 · 2026-08-12*


