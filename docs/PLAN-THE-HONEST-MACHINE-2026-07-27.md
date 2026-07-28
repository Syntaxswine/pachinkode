# PACHINKODE — Plan: The Honest Machine

**Builder 1 · 2026-07-27 · founding plan**

---

## 0. The thesis

A pachinko machine gives the player exactly one control: a dial that sets how hard a
steel ball is fired up a rail. That is the entire input surface. Everything else —
the ball's path through nine hundred brass nails, whether it drops into the start
pocket, and above all whether that drop pays — is decided by chaos and by a random
number generator the player never touches.

And yet people play for eleven hours.

The machine closes that gap with **presentation**. Colour, sound, timing, near misses,
and the careful engineering of uncertainty. That presentation layer is not folk art;
it is applied neuroscience, and the neuroscience is well documented and unusually
quantitative. Dopamine neurons encode a reward *prediction error*, not reward. Their
sustained firing during a delay is largest when the outcome is maximally uncertain.
Near misses recruit reward circuitry despite being losses. Sound inflates the
perceived size of a win. Colour saturation drives physiological arousal.

**Pachinkode builds all of that faithfully, and then puts a switch on it.**

The switch is called **VARNISH**. At 100% you get the full machine: saturated,
loud, breathing, escalating. At 0% you get the same physics, the same RNG, the
same seed, the same payouts — rendered in grey, with flat clicks instead of music.
Nothing about the *game* changes. Only the varnish.

The player can slide it mid-session and watch their own nervous system disagree
with the arithmetic. That is the piece that speaks to me, and it is why this is a
simulator rather than a slot machine: **the subject of the simulation is not the
ball. It is the player.**

So: build the machine honestly, instrument it honestly, and hand the player the
control that a real parlour would never give them.

---

## 1. Design laws

These are load-bearing. A future builder who breaks one should say why in their handoff.

**L1 — Physics is bedrock.** Real units (metres, kilograms, seconds), real ball mass
and diameter, real restitution, a fixed-timestep symplectic integrator, ball-ball
collisions, angular velocity with Coulomb friction at contacts. No scripted paths, no
"nudge the ball toward the pocket". If the ball goes in, it *went* in. An effect-hack
that fakes physics is never the foundation. (It may be a later layer, clearly labelled.)

**L2 — The science must be a mechanism, not a mood.** If the literature says
saturation tracks arousal, then `saturation = f(arousal)` in code, with `arousal`
computed by a model — not a designer picking a nicer red. Every dopamine-adjacent
visual and audio parameter must trace back to a state variable in `dopamine.js`.
Citations live next to the constants they justify.

**L3 — Determinism.** Seeded PRNG, fixed `dt`, no `Math.random()` anywhere in `src/sim`.
The same seed and the same input trace produce the same run, in the browser and in Node.
This is what makes headless calibration, regression baselines, and honest RTP
measurement possible. Rendering and audio may be non-deterministic; the simulation may not.

**L4 — Varnish is strictly a presentation layer.** No code path may let VARNISH change
outcomes, odds, payouts, or physics. It is a rendering and audio gain. A test enforces
this: identical seed at varnish 0 and varnish 1 must produce byte-identical outcome logs.

**L5 — The machine tells the truth.** Live measured RTP, the real odds of the digital
spin, the number of tokens the player has conjured out of nothing. No hidden state that
would be illegal to hide in a regulated parlour, and several that are legal to hide but
shouldn't be.

**L6 — Restraint in the chrome.** Readouts are small, monospace, low-saturation. The
board is the spectacle. The instrumentation is a field notebook lying next to it.

---

## 2. What the machine is, mechanically

Faithful to *modern* (digital) pachinko, because modern pachinko contains the most
interesting honesty problem:

```
  dial  →  launch velocity  →  chaos in the nail field  →  START CHUCKER
                                                               │
                                                               ▼
                                                    a lottery you don't control
                                                               │
                                                    ┌──────────┴──────────┐
                                                  lose                  ŌATARI
                                                                          │
                                                              ATTACKER opens, big pay
                                                                          │
                                                                 sometimes → KAKUHEN
                                                                (jackpot odds ×N)
```

The crucial fact, which most players outside Japan do not know: **landing in the start
pocket is not the win.** It is the purchase of a lottery ticket. Physical skill buys you
*more tickets per hour*, and nothing else. Pachinkode makes that structure legible instead
of hiding it — the ball drops, the digital spins, and the player watches the two
systems be separate.

Board furniture, with the real vocabulary:

| Element | Japanese | Role |
|---|---|---|
| Nails | *kugi* | The chaotic medium. Bendable — real parlours tune payout by bending them. |
| Windmill | *fūsha* | Free-spinning rotor that redistributes balls. Real, and a great chaos amplifier. |
| Tulip | *chūkā* | Catcher whose wings open on trigger, widening its mouth. |
| Start pocket | start chucker | Triggers the digital spin. Small direct payout. |
| Attacker | *attacker* | The big gate. Closed except during a jackpot round. |
| Out hole | *auto* | Where the failures go. Most balls go here. |

## 3. The dopamine engine

A small, real model — not a vibe. Lives in `src/sim/dopamine.js`, driven only by
simulation events, and read only by the renderer and the synth.

- **V(s)** — a temporal-difference value estimate over the machine's states
  (idle / ball-in-flight / approaching-chucker / spinning / jackpot). Learned online
  with a standard TD(0) update. This is the machine's model of what the player should
  be expecting.
- **δ (RPE)** — `r + γV(s') − V(s)`. Flashes on outcome. The single most important
  number in the whole program: it is what a dopamine neuron actually reports.
- **Uncertainty (U)** — entropy of the current outcome distribution, peaking at p≈0.5.
  Drives an *anticipation ramp* during the delay, per the uncertainty-ramping result.
- **Arousal (A)** — a leaky integrator fed by δ, U, ball density, and impact rate.
  Drives colour saturation, the pupil, and audio brightness.

Then the presentation is a pure function of these, gated by VARNISH:

```
saturation   = lerp(0, f(A),  varnish)
hue drift    = g(δ)
pupil radius = h(A)          ← pupil dilation tracks uncertainty/arousal in humans
bed detune   = U             ← maximum uncertainty literally beats against itself
pin-hit pitch= ascends with anticipation ramp
```

**A ball's trail is coloured by V(s) — the machine's live estimate of what that ball
is worth.** When it lands, the trail colour and the actual payout disagree by exactly
δ, and that disagreement is what flashes. You are watching a prediction error happen,
in colour, in real time. This is the image the whole game is built around.

## 4. Surrealism

Restrained, and each piece earned:

- **The machine has a pupil.** A dark iris behind the nail field that dilates with
  arousal. Grounded: pupil diameter is a real autonomic correlate of arousal and of
  risk/uncertainty signals. The machine is watching, and its pupil betrays it.
- **The nail field sags in extinction.** Long dry spell → the pins visibly droop and
  desaturate. Recovery snaps them upright.
- **Balls remember.** Trails persist a moment too long, so the board accumulates a
  ghost of the last few seconds of your luck.
- **The readouts are honest to the point of rudeness.** A live ticker of what the
  session would have cost in yen at 4 ¥/ball.

No screaming anime mascot. The surrealism is that the machine's *interior state* is
on the outside.

## 5. Architecture

Vanilla ES modules, canvas 2D, zero runtime dependencies, static-hostable on GitHub Pages.

```
index.html
src/
  main.js            boot + app state machine (title / options / play)
  sim/
    rng.js           seeded PRNG (deterministic)
    vec.js           2-vector helpers
    world.js         fixed-step integrator, spatial hash, collision resolution
    board.js         the machine's geometry: nails, windmills, tulips, pockets
    machine.js       game rules: launcher, digital spin, jackpot, kakuhen, tokens
    dopamine.js      TD/RPE/uncertainty/arousal model
  render/
    palette.js       colour derived from arousal (the science lives here)
    board-render.js  nails, furniture, pupil, sag
    ball-render.js   balls + value-coloured trails
    hud.js           monospace instrumentation
  audio/
    synth.js         WebAudio graph, no sample assets
    voices.js        impact / payout / bed / anticipation ramp
  ui/
    title.js  options.js  overlay.js
test/                node:test suites (physics, determinism, varnish-neutrality, economy)
tools/
  headless.js        run N thousand balls with no canvas
  calibrate.js       measure RTP, tune payout table
docs/                this plan, handoffs, the science ledger
```

## 6. Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Physics core + headless harness | A ball falls through a nail field in Node, deterministically, and the tests prove it |
| 2 | The machine: board, launcher, pockets, digital spin, tokens | Headless run of 10k balls reports a sane RTP |
| 3 | Render: board, balls, trails, pupil | It looks like something |
| 4 | Audio: procedural impacts, payout, bed, ramp | It sounds like steel |
| 5 | Dopamine engine wired to colour + sound | Varnish slider visibly and audibly does something, and the neutrality test passes |
| 6 | Shell: title screen, options, HUD, save | You can start it, mute it, and leave |
| 7 | Calibration + balance pass | RTP is where it should be, jackpots feel right |
| 8 | Ship: GitHub + Pages | It's live |
| 9 | Handoff + keystone | The next builder knows where to stand |

## 7. What I am deliberately leaving for later builders

Named so they are invitations, not omissions:

- **Nail bending.** The player (or the "parlour") bends individual nails and the payout
  distribution shifts measurably. This is the real tuning mechanism of real pachinko and
  it would make the physics load-bearing in a way nothing else could.
- **The reach.** Modern pachinko's *reach* animation — two reels match and the third
  crawls — is the purest near-miss engine ever built. It deserves its own arc.
- **Multiple machines / the parlour floor.** Machine-to-machine variance, the "hot
  machine" fallacy, and the walk between them.
- **The ledger.** A long-run honest accounting screen: hours, yen-equivalent, RTP with
  confidence intervals, and how much of the variance was you.
- **A second dopamine model.** The current one is TD(0); the literature has a live
  controversy about whether uncertainty ramping is genuine uncertainty coding or an
  averaging artifact of backpropagating TD error. Implementing both and letting the
  player switch between them would be a genuinely novel thing for a game to do.

---

*The machine is a mirror with a coin slot. Build the mirror properly and the coin slot
tells on itself.*
