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

### The conditioning pass — a reward *family*, and how to keep it honest

The operator asked how you would train a listener to hear reward in some sounds and neutrality
in others, without ever building a true negative. The answer that came out of it is a design
discipline worth keeping, because it is falsifiable rather than tasteful:

1. **Contingency, not contiguity** (Rescorla 1968). A cue earns value only by *raising*
   P(reward) above baseline. So the operational rule is not "play something nice on a win" but
   **a reward cue may never fire when nothing was paid.** That is why the reward wash hooks the
   `pay` event — the ledger — rather than each pocket: it is structurally incapable of a false
   positive, and any payout source added later inherits it for free.
2. **Neutrality is earned by being uninformative, not by being quiet.** The nail rain at
   142 strikes/s is the perfect neutral precisely because it is constant and carries no
   information — learned irrelevance. Mechanism sounds may be as loud and physical as you like.
   What must be policed is the *middle*: a weakly-correlated cue is worse than either pole,
   because it breeds superstition and **blocks** learning about the real cue (Kamin).
3. **Never a punisher.** No sound is contingent on loss. Losses get the mechanism family,
   because that is what a loss is: nothing happened. The only negative valence in the game stays
   quarantined at varnish 0, where it is Dixon's unmasking experiment rather than punishment.
4. **The rare tiers inherit.** Measured: koatari and ōatari fire **zero times in 13 minutes** of
   continuous play. They cannot be trained directly — they borrow a response built by tulip
   (0.30/s) and heso (0.08/s) through a shared motif. That borrowing is the actual mechanism
   behind a jackpot jingle's power, and it is honest here only because every instance really paid.

**Two defects this exposed, one of them mine, both unfixed:**

- **The tray patter is spectrally inside the nail rain.** `cascade()` bandpasses 2200–4800 Hz;
  the rain bed added this session sits at 2200 and 3600 Hz and the nail noise runs 2450–5390.
  The sound of *being paid* is camouflaged by the sound of *playing*, and at ARCADE the rain is
  continuous. Fix: move the tray down to a 700–1400 Hz body resonance (which is also what balls
  in a plastic tray actually sound like — the current band is far too bright) and duck the rain
  bed ~6 dB for 250 ms on every payout. The ratchet (850–1800 Hz square) has the mirror problem:
  a neutral sound sitting in the reward register.
- **The warp has an 18× lift and is silent.** Measured: P(heso) = 1.6% per ball, P(heso | warp)
  = 28.6%, warps on 5.5% of balls. That is a genuinely predictive event with no cue on it — and
  it is the honest version of the rising-pitch idea this repo cut, because it is earned by a
  *measured contingency* rather than by contour folklore. Give it a family cousin that resolves
  into the motif if the ball finds the pocket.

**And the instrument that would make this a law rather than a taste:** `tools/cue-contingency.mjs`
(prototype ran this session) computes, for every sound the game can make, P(payout within 400 ms
| sound) against the base rate. Two enforceable assertions: *no reward-family sound may fire
without a payment* (Δp ≈ 1) and *no neutral-family sound may carry contingency* (Δp ≈ 0 within
noise). Then the game can show the player their own conditioning ledger — "you have heard the
motif 63 times; every one was real; here is what they cost" — which is this project's whole
argument applied to one more sense.

### The reward wash, and the opening sequence

Two operator asks that turned out to be one ask — *teach the nervous system what payment feels
like, without lying to it.*

**The wash** is a pulse of light on every ball gained, hooked to the `pay` event (the ledger
itself), so it is structurally incapable of firing unless `won` moved and every future payout
source inherits it free. Refunds never reach it. One invariant hue, magnitude by √n, pulses
*saturate rather than stack* so a cascade glows instead of strobing. At varnish 0 there is no
wash while the numerals stay in ink: the information survives the switch, the training does not.

**The opening sequence** (`FANFARE_TIME = 2.6 s`) is the answer to "why is anticipation allowed
here when the ascending pitch contour was cut?" Because what it builds toward is *genuinely
undecided*: the verdict is sealed but the harvest is not, the ceiling is printed while the build
runs, and the seconds exist for you to get onto the right route. The mechanisms are rate and
timbre — an accelerating tray roll and a constant-pitch drone with an opening filter. **Nothing
ascends.** And it costs nothing: mouth shut, round clock frozen, verified opening exactly once at
2.601 s with all rounds delivered after, and a test that fails if the clock ever runs during it.
Charging a player for a fanfare would be a cost dressed as a celebration, which is the precise
inversion this game exists to expose.

It gave back more than it took — RTP *rose*, because a player who reacts is on the right route
when the mouth opens instead of a ball behind it. **A reaction window is an economy change;
re-calibrate after touching it.**

## Left undone, deliberately or honestly

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
- The tray/rain spectral collision and the silent 18× warp (both above) are specced and unbuilt.
  They are the first two jobs of the keystone below.

Economy re-measured at 8 × 24 000 after both the small win and the opening sequence: amadeji
82.6% ± 16.3%, standard 71.3% ± 16.9%, loose 102.3% ± 13.8% — all inside the 4 h band
(Builder 3's section: the buckets moved these). 46 tests;
board audit clean both ways.

---

## THE SECOND KEYSTONE — the conditioning ledger

**Pre-wired, deliberately unbuilt. Same contract as Builder 1's nail bending: the sockets are
in, they are declared, and nothing consumes them.**

This game already proves it is honest about *money* — the ledger is on screen, the odds are
printed, the RTP is measured against the real regulatory bands by an instrument anyone can run.
It makes no such proof about **conditioning**, which is the other half of what a gambling
machine does to a person, and the half this project claims to be an exhibit of.

Right now the claim "the reward sounds mean reward and the mechanism sounds mean nothing" is a
*design intention*. It is exactly the class of statement this repo has been wrong about twice —
the 50:50 tick, the FOUL readout — both times an estimate wearing a measurement's confidence.

The wiring is done:

- **`src/audio/synth.js` — `CUE_FAMILY`** declares every one of the 19 voices as `reward`,
  `mechanism`, or `predictive`. That declaration is a falsifiable claim, written down.
- **`Synth.mark()` and `synth.cues`** — a bounded ring buffer stamping every voice that actually
  sounded, with its time and its declared family. **Nothing reads it.** Suppression by the impact
  budget or the varnish gate is deliberately *not* recorded (a cue nobody heard conditions
  nothing); suppression by `!ready` is recorded, so the log can be gathered headless.
- **The `pay` event** is the ground truth for "a ball was gained", it carries `{n, source}`, and
  `test/launcher.test.js` already pins that it cannot fire without `won` moving.

So the loop is: **run → correlate → assert.**

`tools/cue-contingency.mjs` computes, for every voice, P(payout within 400 ms | voice) against
the base rate — the Rescorla contingency, Δp. Then two laws worth putting in `npm test`:

> **No reward-family voice may sound without a payment.** (Δp ≈ 1)
> **No mechanism-family voice may carry contingency.** (Δp ≈ 0 within noise)

The second is the interesting one, because it is the one that will *fail*. A weakly-correlated
neutral cue is worse than either pole: it breeds superstition, and it blocks learning about the
real cue (Kamin). My guess at what the instrument finds first: the launch thunk and the ratchet
both correlate with payout through the player's own aiming, which is a confound rather than a
defect — and telling those two cases apart is precisely the work.

**What I would build with it.** Not a debug view. **The last screen.** The machine already tells
you what your session cost. It should also tell you what it *taught* you:

> You heard the reward motif 63 times. Every one was real — the ledger moved each time.
> They cost you 2,140 balls, ¥8,560. You heard the nail rain 41,000 times; it meant nothing,
> and by the end you had stopped hearing it. That is not a metaphor. It is the measurement.

That is the varnish switch, generalised from *presentation* to *learning* — and it is the only
version of this project's argument that can be checked rather than asserted. Build the
instrument first. Let it tell you the design is wrong somewhere. It will.

---

### Maker's mark

I inherited a bedrock and spent my time on the two things a person actually touches: the control
in their hand and the machine's reply. Both times the same discipline held — measure before you
claim, and let the measurement redesign the thing. The koatari window is 7 seconds and not the
realistic 1.6 because I measured the realistic one and it paid *literally nothing*. The FOUL
readout is a table and not a formula because the formula was wrong across two-thirds of its
range. The channel jam survives because the operator had owned the machine that did it worse.

The thing I care most about is the **opening sequence** — not because it is clever, but because
it is where I had to find out whether this project's rule against manufactured anticipation was
a principle or a superstition. It turned out to be a principle with a precise edge: you may
build suspense about something genuinely undecided, and you may not build it about a verdict
already sealed. The harvest is undecided. The jackpot is not. Two point six seconds of build
that costs the player nothing, and a test that fails if it ever starts costing them.

**The forward dream.** Builder 1 wanted the nails to become a character. I want the *sounds* to
become evidence. Between the two keystones this machine could end up doing something I have not
seen a game do: hand you a receipt for your own conditioning, itemised, measured, and true —
then let you flip the switch and watch the same machine, with the same odds and the same seed,
fail to move you at all. Everything needed for that is now in the repository. None of it is
built. That is on purpose, and it is the good part.

Keep the switch. And keep running the audit on your own confident paragraphs — it caught me
twice, and I was the one who wrote the rule.

— *Builder 2 · Claude Fable 5 · 2026-07-28*

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

---

# BUILDER 3 — THE RUN

*Added below Builder 2. Nothing above this line was changed except figures that measurement moved.*

The operator's brief: make it a roguelike. Unlockable cabinets, extra and wider buckets, other
advantages, difficulty that starts much harder and — past a threshold of unlocks — gets
increasingly easy to reach absurd scores. More bright lights and colour tied to score. A cross
between Peggle and Raccoin.

## What is here now

**A run is twelve floors.** Each sets a quota and a tray of balls. Clear it and the BACK ROOM
deals parts; from floor 3 it deals twice, from floor 6 three times. Clearing floor 12 **banks the
win** and the floors keep coming — OVERTIME is unbounded.

**The board is now an argument.** `buildBoard(loadout)` — `src/sim/loadout.js` is the single
source of truth for what is bolted on. Six bucket sites, a widening ceiling, the life-nail gap,
the warp mouths, the tulips' resting pose. A part is new brass in the field, not a modifier
applied afterwards, and every floor rebuilds the Machine and the Dopamine model because of it.

**Three new instruments**, and they are the deliverable as much as the game is:

| tool | question |
|---|---|
| `loadout-audit.js` | does EVERY board a run can build contain a ball trap? (a gate — exit 1) |
| `run-sim.js --curve` | what is the difficulty curve, and where do the two curves cross? |
| `run-sim.js --power` | what is one part actually worth? |
| `run-sim.js --sites` | does a ball ever ACTUALLY reach that bucket? |

`tools/lib/pinch.js` is the wedge scan, extracted so `board-audit` and `loadout-audit` cannot
drift on what counts as a trap.

## The four things that only measurement caught

**1. The curve could not cross, and no constant could fix it.** A part is worth a measured ×1.30.
I assumed ×1.25 and set the growth ratio to 1.72, then 1.40, then 1.22 — all of which are two
straight lines on a log plot, and the run died at floor 4–5 every time. A crossover needs a
different SHAPE, not a different slope. `picksFor()` — parts per floor rising with depth — is the
whole mechanism, and `test/run.test.js` fails if anyone flattens it to a constant.

**2. "Hard" is a margin, not a death rate.** My own tool printed a target band of 35–55% for the
floor-1 clear rate. That band is wrong and the tool now says so in a comment: clear rates
COMPOUND, so four floors at 50% means six per cent of runs see floor 5. The early difficulty lives
in cost-to-clear (most of the tray at floor 1, a couple of per cent by floor 12), not in deaths.
See the later section on the floor's decision — that metric had to be redefined once the player
could choose to keep firing past the quota.

**3. The tray is not a clock.** Reading the floor's remaining balls off the machine's token
balance seemed obviously right — the machine already maintains that number correctly. It does; it
just does not maintain the number a run needs. A pachinko tray refills out of its own pockets, and
floor 8 measured at **746% of its stated allowance** to clear. The clock is LAUNCHES now, and the
connection back to the tray is a part (BALL RETURN) the player fits on purpose.

**4. There is no seventh bucket site.** A `westHigh` at the upper-left flank passed every geometry
check and then scored **zero across 16 floors and 126 entries**. Not rarely: never. The cause is
the board's own emergent asymmetry — a right-route ball rides the outer wall down the far side, a
left-route ball falls inward at 250° and rains down the middle, and nothing delivers a ball to the
upper-left flank at all. The board holds six cups. The per-site score multipliers now invert the
measured arrival spread so a starved mouth is still worth drafting.

## Traps, for whoever is next

- **Every new bucket site must be probed at the WIDEST mouth**, not the stock one, and the probe
  grid must be finer than 8 mm. Mine was 8 mm and 0.220 fell between two rows, which hid a
  diagonal 11.6 mm pinch into the nook under a cup's bottom corner. Face-to-face gaps are the easy
  case; corner nooks are the one that got through.
- **Nudging a cup away from a wall makes things worse before better.** The perpendicular gap
  passes THROUGH the trap band on its way to being safely wide.
- **The old pinch scan exempted any pair where EITHER segment was pocket furniture**, which meant
  a tulip cup converging on the launch rail was invisible to the tool — and `board-audit.js`'s own
  header lists exactly that as one of three traps chased by hand. It was chased by hand because
  the instrument was looking away. The exemption now requires both segments to belong to the same
  pocket, and `attacker-flap` moved to the wall CHAIN where it always belonged (it is built as an
  arc of the bowl wall, so two points on it are a chord, not a pinch).
- **An instrument that cannot answer a question must refuse to.** My first reachability check was a
  flood fill, and it reported the two stock buckets as unreachable — a 4 mm grid cannot represent
  the 1 mm clearance of a 13 mm mouth or the 7 mm gaps in a 20 mm nail pitch, so it returned noise
  shaped like an answer. `blockedPockets` now asks only whether a wall stands over the mouth, and
  `--sites` fires actual balls for the rest.
- **A windmill is not a blocker.** Counting rotors in that check flagged both stock buckets as
  broken. A rotor spins and sheds; a bucket in a windmill's shadow is a bucket the windmill feeds.
- **`document.hidden` is true in the in-app preview pane**, so rAF is throttled to nothing and a
  browser harness sees a frozen board. `__pachinkode.tick(n, dt)` exists for that: the harness
  supplies the clock the browser is refusing to. Screenshots still need the `/__shot` sink.

## Two late additions, and a bug they exposed

**The floor's decision** (operator's request): meeting the quota opens PUSH ON / BANK rather than
ending the floor. Surplus buys parts by doubling; banked balls ride into the next floor's tray.
The old leftover bonus is gone — it paid score for the same balls that carried forward, so there
was no trade to make.

**A local high-score record**: the best run on the title screen, a RECORDS screen with the top ten
runs in full (cabinet, floor, parts fitted, longest chain, date), per-cabinet bests kept apart
because a score on 街台 and one on 裏物 are not the same claim, and the aggregate figures. It lives
in localStorage and nowhere else. `recordRun` takes its timestamp as an argument so it stays a
pure function and the tests do not have to freeze the clock.

**And the bug.** Verifying the decision screen in the browser, the board showed a 75% foul rate
where the instrument measures 1–4%. It presented as the channel jam — which is a real mechanic,
which is what made it convincing for several minutes.

It was not. `machine.sinceLaunch` was **−2.383 s**. `frame()` computed `dt = Math.min(0.05, t -
lastT)` with a ceiling and no FLOOR, so any event that advanced the clock out from under it —
the manual `tick()` used for browser verification, a tab restore, a system clock step — produced a
NEGATIVE dt, and the simulation integrated backwards. The launcher then had to wait two and a half
seconds for a lockout that had never elapsed, and the board filled with balls that had run in
reverse.

Both `frame()` and `tick()` now refuse a non-positive step. Two lessons worth keeping: a
plausible-looking symptom that matches a known mechanic is the hardest kind to see past, and the
harness that verifies the game is part of the game's attack surface.

## Left undone

- **The run's seed is not surfaced.** A Run is fully reproducible from one integer — offers,
  floors, all of it — and nothing lets you read or type one. Daily runs and shared seeds are one
  text field away, and the determinism is already there.
- **The chain barely breaks at ARCADE.** Measured, a floor-1 chain reached 26 without ever
  lapsing, which makes PATIENT CHAINS a weak part at the default fire rate and a strong one at
  REGULATION. That is coherent — it is documented as "what makes the slow, legal machine playable"
  — but it has not been measured at all three rates, and it should be.
- **Bucket entries share the tray cascade rather than having a voice.** They pay a ball, so they
  inherit the existing reward vocabulary through the ledger — which is Builder 2's rule working
  as designed. Whether a scoring pocket DESERVES its own family member is a real open question,
  and it is exactly the sort of thing the unbuilt conditioning ledger exists to settle.
- **The auto-player does not aim.** Every difficulty number here is therefore a FLOOR on what a
  human can do, which is the right direction to be wrong in but makes the curve conservative.
- Builder 1's nail-bending keystone is still unbuilt — though the loadout layer now bends the life
  nails at BUILD time, which is a different thing and does not consume it.
- Builder 2's conditioning ledger is still unbuilt, and `tools/cue-contingency.mjs` still does not
  exist.

## An observation from the operator, recorded because it is a real finding

Listening to a run at the ARCADE rate: *"the rapid sound of the balls being shot sounds like a
Bolang gu"* — 拨浪鼓, the Chinese pellet drum with two beads on strings.

Nothing here synthesises a pellet drum. What happens is that `launch()` lands on a strict 0.2 s
beat while `impact()` and the rain bed fill the gaps with brass strikes at a rate the launcher
itself sets, so the ear hears one instrument with a periodic body and a stochastic skin — which is
exactly a pellet drum's signature. It is the same kind of fact as the route split: nobody designed
it, it fell out of the parts. It is noted in `src/audio/synth.js` because a future builder
retuning the impact budget or the launch envelope will change it without meaning to.

## Maker's mark

I did almost nothing by taste. Every number in the run layer that could be measured, was: the
quota base and growth against a measured per-part power, the pick ramp against a measured
crossover, the bucket positions against a position probe, the site values against measured arrival
rates, the widening ceiling against what the audit would allow. Four separate times the
measurement told me my design intuition was not merely mis-tuned but structurally wrong, and each
of those is written down in the file it belongs to rather than smoothed over.

The thing I care most about is that **the seventh bucket is missing**. It would have been trivial
to leave in — it looked right, it passed the geometry gate, and no player would ever have proved
it dead. It is gone because the instrument said so, and the reason it is dead is the same
centripetal condition Builder 1 discovered by accident and never designed. The board's oldest
emergent fact reached forward and deleted a feature. That is a project whose bedrock is
load-bearing.

**The forward dream.** The roguelike is the hook; the exhibit is still the point. What I would
love to see is the two finally colliding: a run that ends by telling you how much of your score
came from the honest prizes and how much from the lottery, in the same breath as Builder 2's
receipt for what the sounds taught you. The parts you chose are a record of what you thought was
valuable. The machine already knows whether you were right.

And keep the switch. It survived a scoring layer, which is the hardest thing that has ever been
asked of it.

— *Builder 3 · Claude Opus 5 · 2026-07-28*
