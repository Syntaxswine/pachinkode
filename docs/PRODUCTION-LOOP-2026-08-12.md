# Production loop — 2026-08-12

This pass responds to the hostile review of the game as played, not just as
described. Its target is reward salience and conditioning—not a literal claim
that software can cause or measure a player's dopamine release.

## Build order and acceptance gates

1. **Cue and model integrity**
   - Pocket outcomes feed `Dopamine.push()` the prediction error returned by
     `settle()`, including negative errors on drains and fouls.
   - A hidden reach cannot enter a public event or sound until the first two
     reels visibly stop.
   - Chain, warp, gate, and payout-tray cues have distinct, measured meanings.
   - The tray occupies 520–1500 Hz and ducks nail rain by roughly 6 dB for
     250 ms.

2. **Staged presentation with a comfort boundary**
   - A deterministic presentation director arbitrates pocket, warp, chain,
     reach, small-win, quota, jackpot-build, jackpot, and floor scenes.
   - Forty-eight marquee lights run continuous chases, convergences, wipes,
     and festival patterns. There is no strobe path.
   - Reduced Effects independently removes shake and the full-field reward
     wash, freezes travelling patterns, and caps payout flashes and lamps at
     18â€“24% strength. It does not touch sound, facts, odds, payouts, or physics.

3. **Late-run traffic**
   - AUTO HANDLE is a rare, single-stack part offered from floor five.
   - It is toggled with `A` or the top-bar control, always fires at the player's
     exact BASE strength, and leaves charged manual shots authoritative.
   - Its 3:1 motor raises Arcade from 300 to 900 launches/minute. The density
     test requires a material increase in mean and maximum live balls.

4. **Narrative map**
   - KAWADAI is a wide-centre river board. The nail banks outline an open
     120–160 mm descent instead of a central LCD block.
   - Procedural print identifies SOURCE, BRIDGE, WHIRLPOOL, and HARBOUR; balls
     tell the story by physically travelling it.
   - Two dead/blocked candidate bucket berths were removed after the motif
     instrument failed them. The surviving four are all measurably alive.

5. **Conditioning instrument and receipt**
   - `npm run cue-audit` measures per-voice payout contingency over real Machine
     events with a 400 ms reward/mechanism horizon and a five-second predictive
     horizon.
   - The instrument caused three design changes: the redundant spin-start tick
     was removed, the attacker gate was split into predictive opening and
     mechanical closing identities, and every family now uses a base chance
     measured over its own horizon.
   - Production receipts count only cues that reached a running, unmuted,
     nonzero-volume audio bus. Headless audits opt into virtual listening
     explicitly, so pre-gesture silence cannot masquerade as exposure.
   - The end screen itemises aimed vs lottery score, chain-created score,
     playable balls and fouls, yen-equivalent cost, cue counts, payout backing,
     predictive follow-through, and measured mechanism contingency.

## Verification record

- Tests: **163 pass, 0 fail**.
- Loadout audit: **305 boards, 0 traps**.
- Motif audit: TANUKIDAI and KAWADAI clean across every intermediate ladder;
  every shipped pocket and tulip alive.
- Cue audit, 1,500 launches: **393/393 reward cues payout-backed**; predictive
  follow-through **173/173**, compared with its honest five-second base of 84%
  for **+16 percentage points**; aggregate mechanism contingency **+4 points**
  over its separate 27% 400 ms base chance.
- Economy curve, 12 runs: floor-one clear **100%**, floor-two clear **92%**,
  crossover **floor 4** (accepted band 4–8).
- Quick canary: quiet, exit 0.
- Live browser: title/options/play, Full/Reduced Effects switch, stock scene
  lighting, and KAWADAI live-physics preview visually inspected.

## Hostile-review gate

The independent reviewer scored the successive release candidates **8.3**,
**8.7**, and **8.9**. Every blocker re-entered the build loop. The fourth review
scored the final tree **9.3/10** and certified it with no release blockers.
