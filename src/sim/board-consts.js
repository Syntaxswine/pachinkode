// The board's fixed dimensions, split out from board.js for one reason only:
// loadout.js needs them, and board.js needs loadout.js. A cycle between those
// two would work under ES modules and then break the first time somebody
// reached for a constant during module evaluation rather than inside a
// function. Constants have no dependencies, so they go in their own file and
// the cycle cannot form.
//
// board.js re-exports BOARD, so every existing importer is unaffected.

// Regulated dimensions, from NPSC Rule No. 4 of 1985, appendix 4. The playfield
// must fit inside a 500 mm square and must contain a 300 mm circle; 440 × 490 mm
// with a 412 mm rail circle satisfies both. Pocket mouths are capped by law and
// those caps are tight against an 11 mm ball — a closed prize pocket may be no
// more than 13 mm across, which is two millimetres of margin.
export const BOARD = {
  w: 0.440,
  h: 0.490,
  // Render-only strip below the playfield holding the launcher cutaway. Not part
  // of the simulated world — no ball ever enters it — but the mechanism it shows
  // is real state, read straight off the Machine.
  // Deepened 0.086 → 0.104 (operator's ruling, 2026-07-30): the base slider
  // is the game's one continuous control and its strip is the hit target —
  // it earns the real estate. Render-only; the field above never moves.
  cabinetH: 0.104,
  rail: { cx: 0.220, cy: 0.246, r: 0.206, gap: 0.0200 },
  railStart: 130,      // deg — where the ball enters the channel, bottom-left
  railInnerEnd: 250,   // deg — the threshold. See board.js's header note.
  railOuterEnd: 352,   // deg — the outer channel wall runs on round to here
  returnRubber: 337,   // deg — the return wedge. See buildRail().
  bowlGap: [78, 102],  // deg — the out hole

  // Regulated mouth widths (metres).
  mouthClosed: 0.013,  // prize pocket / gate, maximum
  mouthTulip: 0.050,   // powered tulip when open, maximum 0.055
  mouthAttacker: 0.070, // attacker when open, legal band 0.055–0.135

  // The heso gap: the clear span between the two "life nails" above the start
  // pocket. Real boards run 11.25–12.50 mm against an 11.00 mm ball, adjusted in
  // 0.25 mm steps with plate gauges. Half a millimetre here is the difference
  // between a parlour making money and losing it. This is the single most
  // sensitive number in the entire simulation, and it is *supposed* to be.
  //
  // Since the roguelike, this is the STOCK value — the loadout may open it, and
  // a part exists whose entire content is doing so. See loadout.js.
  hesoGap: 0.0125
}
