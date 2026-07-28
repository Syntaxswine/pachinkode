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
   rail forever and drains without touching a nail. Real machines solve this with the 返しゴム,
   the return rubber, and so does this one.

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
