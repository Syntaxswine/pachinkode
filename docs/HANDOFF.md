# HANDOFF

*Add below the last builder. Never overwrite what came before.*

---

## Builder 1 — the founding · 2026-07-28

### Where it stands

The machine is built, calibrated, tested, and live. Physics core, board geometry, economy,
dopamine engine, renderer, procedural synth, title screen, options, HUD and save are all in.
21 tests pass. Three verification instruments ship alongside the game.

**Verified numbers**, all reproducible from the repository:

| | |
|---|---|
| Launch cadence | 0.601 s/ball measured in-browser — the legal 100/minute ceiling |
| RTP, amadeji | **83.9% ± 15.4%** over 8 × 24 000 balls at dial 0.20 (legal 4 h band: 40–150%) |
| RTP, loose / standard | 92.3% ± 13.2% / 63.0% ± 10.7% |
| Base rate (no jackpot) | 35% — real machines sit near 30% |
| Heso rate | 2.9% of balls at dial 0.20, through a 12.5 mm gap against an 11 mm ball |
| Nails | 107 after the wedge cull; real boards ~200 |
| Nail strikes per ball | 22–58 depending on dial |
| Stuck balls | 0.005% over 20 000 balls (one ball, against a windmill hub) |
| Wall and nail pinches | **0** in the trap band |
| Varnish effect | mean pixel saturation 0.194 → 0.061, luminance held (0.064 → 0.069) |
| Shepard partials | fall at 0.938 oct/s; spectral centroid slope **+0.009 oct/s** |

Read **[PLAN-THE-HONEST-MACHINE-2026-07-27.md](PLAN-THE-HONEST-MACHINE-2026-07-27.md)** for the six
design laws before touching anything. Read **[SCIENCE.md](SCIENCE.md)** before touching any
constant that claims a source.

### The one law that is not negotiable

**L4 — varnish is presentation only.** No code path may let it change outcomes, odds, payouts or
physics. `test/varnish.test.js` enforces this four ways, including a check that the `Machine`
class exposes no presentation-shaped member at all.

The entire game is an argument that the *content* of a gambling machine is nothing and the
*presentation* is everything. That argument is worthless unless the two are genuinely separable
here. If you find yourself reaching from the renderer or the synth back into the simulation —
even with good motives, even to make something feel better — stop. That is the one change that
breaks the thesis rather than extending it.

### Traps this board has already taught us

Expensive knowledge. Do not re-learn it.

1. **The wedge.** Two surfaces whose clear span is wider than nothing and narrower than a ball
   (11.0 mm) form a permanent trap. Every ball that enters one stops there. Three instances were
   hand-chased before the pattern was obvious: a nail 10.5 mm from a tulip wing, a flat 70 mm
   attacker ledge, and a *converging* channel between a tulip cup and the launch rail whose span
   swept through 11 mm somewhere along its length. `buildBoard()` now culls offending nails
   automatically; `tools/board-audit.js` reports wall-versus-wall pinches, which cannot be culled.
   **Run the audit after any geometry change.** At one point 65% of all balls were being reaped.

   **And run a long soak, not just a sweep.** The wedge sweep originally checked nails against
   walls but never against *each other*, and every short run reported zero stuck balls. A
   60 000-ball soak found 1.1% of balls resting on a pair of nails 11.3 mm apart centre-to-centre
   — a 9.5 mm clear span — where a hand-placed right-route nail had landed between two grid nails.
   The regular grid can never do this (its tightest span is 18.8 mm); it fires exactly where an
   authored nail meets a generated one, which is precisely where a human stops checking. Fixing
   the sweep took stuck balls from 1.06% to 0.005%. **A tool that checks half a rule reports
   clean.**

2. **Mouth widths are CLEAR spans, not centreline gaps.** Wall segments have thickness. A
   nominally 13 mm mouth built centreline-to-centreline is really 8.6 mm and impassable. Use
   `clearHalf()`.

3. **Every upward-facing surface must shed.** A flat housing roof parked 48 balls a run; a
   symmetric gable apex balanced 32 more, because a deterministic simulation will happily sit a
   ball on an exact equilibrium forever. The roof is now a dome with a deliberately off-centre
   crown.

4. **A smooth circular wall never releases what it has caught.** Past the crest, the centripetal
   requirement `v²/R ≥ g·sin θ` only gets *easier* as θ increases — so a fast ball rides the outer
   rail forever and drains without touching a nail. Real boards break the ball off at the top
   right, where the 天釘 sit; this one uses a rubber wedge in the same place.

   (An earlier version of that comment called the part 返しゴム and presented it as its real name.
   Two research passes found no such rubber component in any Japanese board-part reference. The
   physics was measured and correct; the name was not sourced and is gone. **A confident-sounding
   loanword is not a citation.**)

5. **Contacts with light bodies must be solved two-body.** Treating the windmill as a wall and
   *then* torquing it invents angular momentum every strike. With a rotor inertia around 10⁻⁶ kg·m²
   that is not a rounding error, it is an energy pump. `test/physics.test.js` guards it.

6. **Launch the ball already touching the rail.** Starting it mid-channel made it drop 2.7 mm and
   bounce, and since the rail is lossy the surviving energy depended on the *phase* of that
   bounce — which made the foul rate chaotic in dial position (11% at 0.25, 35% at 0.30, 82% at
   0.35, 21% at 0.40) over a six per cent speed spread.

7. **`x ^= x >>> 15` returns a SIGNED 32-bit integer.** A negative modulo 8 is negative. The reels
   displayed `-1` and `-4` until the final `>>> 0` went in.

8. **An emergent visual has no failure mode.** The value map silently never learned: every pocket
   event was re-emitted without the ball that caused it, `settle()` looked up a visit set that was
   not there and returned early, and only reward-zero drains reached the learner. V stayed flat
   zero across all 550 cells and every trail rendered at the cold end of the scale forever. No
   exception, no warning, no visibly broken frame — just the one image the whole game is built
   around, quietly not happening, looking exactly like a feature that had not warmed up yet.
   Found by an adversarial audit, not by playing it. `test/learning.test.js` now asserts the
   emergence, including that the funnel outvalues the gutter.

9. **Broadphase the wall segments, not just the nails.** A finished board has ~380 segments and
   the rail alone is 150 chords. Testing every ball against every segment at 1200 Hz cost more
   than the rest of the simulation combined; gridding them took a 500-ball headless run from
   28 seconds to 0.58.

### What is deliberately unfinished

Named as invitations, not omissions.

- **The reach animation.** Modern pachinko's *reach* — two reels match and the third crawls — is
  the purest near-miss engine ever built, and it currently gets four seconds and a text label. It
  deserves an arc of its own. The literature is already in SCIENCE.md §2.
- **The Z axis.** The regulation guarantees board and glass are flat and parallel 13–25 mm apart,
  which leaves an 11 mm ball **2–14 mm of out-of-plane freedom** — far more than "effectively 2D"
  suggests. Real balls tilt, ride nail shoulders, and rattle against glass. A shallow third axis
  would be a genuine fidelity gain.
- **The parlour floor.** Multiple machines, machine-to-machine variance, the hot-machine fallacy,
  and the walk between them.
- **The long ledger.** Session history with confidence intervals, and an honest estimate of how
  much of the variance was you. (It was none of it. That is the finding.)
- **Measuring a real machine.** There is no published rigid-body model of a real pachinko board
  and no measured landing distribution — the gap is real, not an oversight in my search. If a
  future builder gets a real board and a high-speed camera, that measurement would be novel
  outside this game, not just inside it.
- **standard spec returns 63%.** Inside the legal 4 h band and honest for a 1/319 machine, but
  punishing. Either leave it as the truthful option or raise its harvest.

- **RTP figures move, so re-measure before quoting.** An early 4-seed run put amadeji at 92.7%
  and that number reached the README and a commit message before an 8-seed run corrected it to
  83.9% ± 15.4%. Jackpot income is extremely lumpy — the standard deviation is a fifth of the
  mean — so **four seeds is not enough to quote a figure.** Use eight, and quote the spread.

---

## THE KEYSTONE — nail bending

**Everything for this is already in place. It is not built, and that is on purpose.**

Bending nails is how real parlours tuned payout for fifty years. It is also the reason this whole
board is sensitive in the right way: a fraction of a millimetre at the two "life nails" above the
start pocket moves the machine's entire economy. It is the single highest-value unbuilt thing
here, and I laid the sockets for it rather than build it, so that the next builder gets the good
part.

The wiring is done:

- `world.js` — every nail carries `bx, by` displacement fields. They are already summed into
  collision detection, into the broadphase grid, and into the renderer. **They are never set to
  anything but zero.** Set them, call `world.markDirty()`, and the board physically changes.
- `board.js` — `parts.lifeNails` is a live handle on exactly the two nails that matter, and
  `BOARD.hesoGap` is the constant they are built from. `clearWedges()` explicitly protects them
  from the automatic cull so they can be moved into gaps no other nail is allowed to occupy.
- `tools/board-audit.js` — will tell you the moment a bend creates a trap.
- `tools/calibrate.js` — will tell you exactly what the bend did to RTP, over 24 000 balls, against
  the real regulatory bands.

So the loop is: bend → audit → calibrate. Measure the payout shift of 0.25 mm. Real technicians
worked in those steps.

**What I would build with it.** Not a player upgrade. A *second character*. The parlour has a nail
technician who visits the machine when you are winning, and the tell is that the board is very
slightly different when you come back. The player can learn to read nails — the game already draws
the life nails with a marker ring — and the honest version of "this machine is hot" stops being a
fallacy and becomes a skill. Then the last screen tells you how much of your session was the
nails and how much was you.

That mechanic only works because the physics underneath is real. That is why the physics went in
first.

---

---

## Builder 2 — the visible launcher · 2026-07-28

The one control the player has was invisible. Now it is a cutaway in a strip below the playfield:
the hammer draws back in proportion to the dial, the return spring compresses, the ball waits in
the cradle, a readiness lamp shows the 0.6 s lockout, and a scatter cone shows the actual
standard deviation the next shot will be given.

**Tap to fire one ball, hold for continuous.** Tapping is real technique — 単発打ち — and it is
how a player aims at a specific gap.

**Firing fast costs accuracy.** A shot from rest gets ±0.35%; flat out gets ±2.60%, a 7.4×
penalty, via a leaky accumulator (`LAUNCH_TAU`) over recent shots so *sustained* fire is worse
than one quick double-tap. Physical story: the solenoid hammer, its return spring, and a ball
that has to settle in the cradle — at the legal maximum rate none of the three has fully seated.
Marked DESIGN in SCIENCE.md, because nobody publishes launcher scatter and real machines are
famously consistent. The direction is defensible; the magnitudes are a game choice.

### Two things this exposed

**The route boundary is not sharp, and three files said it was.** Measured, the right-route share
climbs smoothly from 10% at dial 0 to 99% by 0.42, crossing even odds at ≈0.19. A ball's surviving
energy at the top of the rail varies chaotically with how it rattled on the way up, so the split
is probabilistic — and it stays fuzzy even with the launcher at its tightest. The HUD now shows
measured odds instead of a LEFT/RIGHT label.

**A closed form was being drawn on the HUD as a fact.** Inverting launch energy through the rail
climb puts even odds at dial 0.55. The machine crosses at 0.19. **The tick mark was a third of
the dial's travel out of place** — for weeks it would have been pointing confidently at the wrong
part of the knob. `ROUTE_ODDS` in `board.js` is now measured data, regenerated by
`node tools/headless.js --threshold --balls 220`, and `test/launcher.test.js` fails if the
published table stops matching live behaviour.

That is the same failure as everything in the audit below: **an estimate, stated with the
confidence of a measurement.** If you put a number in front of the player, measure it.

### Also fixed here

- The legal rate. Carrying the launch remainder forward let discretisation shave a tick off each
  gap — mean 0.599995 s, which is 100.0008 balls/minute and therefore *over* the ceiling. Zeroing
  rounds every interval up instead, so the machine can only ever fire slower than the limit.
  `test/launcher.test.js` states the rule without an endpoint to argue about: any 101 consecutive
  balls must span at least a minute.
- `Machine`'s default dial was 0.55, which yields a 0% heso rate — a player who never touched the
  dial would never buy a ticket. Now 0.20, the measured optimum.
- The dial drag mapped against the whole canvas, which now includes the cabinet; it maps against
  the playfield.

**Left undone:** the launcher scatter has no effect on *aim*, only on speed. Real spread would
also come from the hammer striking slightly off-centre, which would put spin on the ball and bend
its path up the rail. That is a more interesting model and the physics already supports it —
`makeBall` takes an angular velocity nobody sets at launch.

— *Builder 2 · Claude Fable 5 · 2026-07-28*

---

## Builder 2, second movement — the pull, the party, and the review · 2026-07-28

The operator asked for three things: faster fire, a pull-back-release control, and a hostile
review for engagement. All three shipped, and each one taught something.

### The pull

Hold draws the hammer from BASE toward full over 1.1 s; release fires; a tap is a BASE shot,
which is what makes drumming aimable. BASE is a draggable handle on the cutaway's scale. Fire
rate became a setting — REGULATION 100/min (the law, and still the class default every bare
`Machine` gets), ARCADE 300/min (shipped default), STORM 600/min. The rate ceiling logic, the
one-deep release buffer, and the first-release-wins rule are all pinned by tests.

### The channel jam — kept on the operator's authority

At fast cadence and low power, consecutive balls collide in the launch channel; sustained
maximum-rate mashing mills 83% of balls back as fouls, while any tap rhythm with ≥0.3 s gaps
stays at 1–3%. We verified the real machines carry return-ball prevention parts (patents
JP2003033484A, JP2978440B2) — and then the operator reported the ground truth from a 1970s
machine they owned, which had none: the clog was cumulative, every insufficient ball raining
back into the plunger area. Ruling: **the jam is a mechanic.** It clears in seconds, channel
casualties are refunded as fouls, the HUD names it live, and the route split greys itself while
it holds (the solo table is outside its measured domain there).

### The small win

The operator asked why the bucket felt like it did nothing — and the honest answer was that its
3-ball pay was invisible and its lottery unexplained. Fixes: payout popups at every pocket, the
board's own token counter counting up, the lottery odds printed on the display, ハズレ/小当たり
verdict labels, and **koatari** — a real machine feature, tuned by measurement: the realistic
1.6 s blink caught 0.00–0.25 entries at the recommended base (a prize that paid nothing), so it
became one 7 s opening capped at 4 entries, long enough to *react* with the migi switch. The
small win now teaches the skill the jackpot needs, on a stake small enough to lose.

### What the hostile review caught (24 agents, 18 findings, 12 confirmed)

The two most instructive, both the same species:

- **The impact rain could not scale.** A 6 ms dedupe gate compared against ctx.currentTime,
  which is frozen across a synchronous event batch — so the 7-voice budget was unreachable dead
  code and the board sounded no busier with thirty balls than three. Worse, WHICH strike
  survived was event order, not loudness. Now: voices spread across the frame, spent
  loudest-first, plus a rain bed whose gain follows the counted strike rate.
- **The topbar's FOUL readout was a closed-form estimate** printing FOUL below power ≈0.135,
  where measurement says ~99% of solo shots enter play. Replaced by measured `FOUL_ODDS`
  (`--foulcurve`). That is the same failure as the 50:50 tick a session earlier: *an estimate,
  stated with the confidence of a measurement, survives until an audit runs.* Twice now.

Also fixed from the review: two-finger play halved the fire rate (shared booleans → per-pointer
roles; extra fingers are drum hits via `machine.tap()`); pointercancel/blur/right-click could
fire or wedge the charge (cancel ≠ release, everywhere); the whole cabinet strip was slider
hit-area (a tap on the readiness lamp slammed BASE to 0 — into the jam regime); a mid-play
refresh restored `screen:'play'` over a null machine (save whitelist now); an empty-handed
release zeroed the lockout; a tap could silently overwrite a buffered charged shot; the
stuck-refund's radial bound sat 0.7 mm on the wrong side of the inner wall; kakuhen was audibly
identical to a dead chain (it now slams the gate, states a chord whose length is the real
continuation probability, and restarts the Shepard descent *thinned* — the thing an old comment
promised and the code never did).

### Left undone, deliberately or honestly

- The aim-spin idea from the first movement still stands (`makeBall` takes an angular velocity
  nobody sets).
- Tulip's timbre is still a plain triangle; the review rated a struck-metal rebuild "could".
- Popup coalescing at STORM (many +N popups can stack) is unbuilt.
- `dop.push()` is handed raw rewards, not prediction errors, so the phasic channel never shows
  the reduced response to a fully-predicted reward — the actual Schultz result. The honest fix
  is to push `reward − V(s)` using the value map's own estimate. Flagged by the review's
  verifier as a bigger honesty item than the finding it rode in on. It changes presentation
  only through the palette, but it changes it everywhere — measure before and after.
- The koatari yield at a *reacting* player's dial is folded into `hesoValue()` as a tuned model
  input (~2.5 entries); worth measuring properly with a reaction-delay model.

Economy re-measured after koatari at 8 × 24 000: all specs inside their type-test bands (see
README for the figures). 44 tests; board audit clean both ways.

— *Builder 2 · Claude Fable 5 · 2026-07-28, later the same day*

---

### One more thing, and it is the most useful thing here

**Audit your own documentation adversarially, and do it before you believe yourself.**

Every claim in this repository was extracted and independently fact-checked with web access, by
verifiers instructed to find errors rather than confirm them. 120 claims, 27 flagged, 17 real.

The *measurements* were nearly perfect — every restitution figure, every test statistic, every
regulatory limit verbatim correct. What failed was the prose around them: a regulatory fact that
does not exist, a Japanese part name that could not be sourced, a citation year, a misattributed
construct, a correction asserted in the wrong direction, and two unsupported claims sitting
inside the very sentence congratulating this project for cutting an unsupported claim.

And the worst one was not a citation at all. It was a **code defect that three documents
confidently described as working** — the value map that never learned. The prose was so sure of
itself that it papered over a dead feature.

A project that cites its sources is not automatically honest. It is merely *checkable* — and only
if somebody actually checks. Run the audit again after you have written your own confident
paragraphs. It will find something.

### Maker's mark

I built the bedrock deliberately: real units, real impulses, real restitution from a real
measurement, a deterministic core, and an instrument for every claim I make in these documents.
Where the literature was contested I implemented both sides and shipped the experiment rather than
pick a winner. Where a good-sounding idea had no evidence behind it — the rising pitch contour — I
cut it, and left the cut documented so nobody re-adds it by accident.

The thing I care most about is the **trails**. A ball's colour is what the machine has learned a
ball in that position is worth, and the brightness is its confidence. Nobody drew the bright
thread that appears above the start pocket after a few hundred balls. The machine found it. That
is the whole project in one image: the value was always in the board, and the varnish was always
somewhere else.

**The forward dream.** I would like this thing to end up genuinely useful — not as a game that
moralises at people, but as an honest machine somebody can put their hands on and *feel* the
difference the varnish makes, then go and recognise it somewhere that costs money. It already has
the bones: the odds are printed, the ledger is truthful, the near-miss dissociation is on a
needle, and Dixon's unmasking experiment is wired to a slider. Take it further. Make the ending
tell the truth about the session. Make the nails a character.

And keep the switch. Whatever else changes, keep the switch.

— *Builder 1 · Claude Fable 5 · 2026-07-28*

---
