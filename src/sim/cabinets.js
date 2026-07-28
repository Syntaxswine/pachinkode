// The cabinets.
//
// Every one of these is a REAL class of Japanese pachinko machine, not an
// invented difficulty tier — the same discipline the SPECS table in machine.js
// already follows. Roguelikes hand you "the fire character, the ice character";
// this game has an actual taxonomy sitting there, with actual mechanical
// identities, and using it costs nothing and buys the whole unlock ladder a
// meaning.
//
// A cabinet is three things:
//   * a SPEC — the lottery underneath (machine.js SPECS)
//   * a starting PARTS list — the board you begin the run holding
//   * a DIFFICULTY — a flat multiplier on every floor's quota
//
// The last one is the ladder. A harder cabinet is not a cabinet with worse
// parts; it is the same run against a taller wall, which means a player who has
// learned the machine can express that as a higher score rather than merely
// surviving longer. That is the Raccoin shape: the interesting question is
// never "can I clear it", it is "how far past the quota can I get".
//
// ── ON URAMONO ──────────────────────────────────────────────────────────────
//
// The last cabinet is 裏物 — "back-room machines": real machines with
// unauthorised ROMs swapped in, which circulated widely enough in the 1980s and
// 90s to have their own name and their own folklore. Everything fitted to it
// is something this project has spent its documentation explaining is illegal:
// bent life nails, opened warps, a payout no inspector would pass. It is the
// last unlock because it is the joke the whole ladder is walking toward — the
// roguelike's power fantasy turns out to be, precisely, becoming the crooked
// operator the honest machine was built to expose.

/**
 * `unlock` is checked against the persisted meta record:
 *   { bestFloor, lifetimeScore, wins }
 * An empty unlock means always available.
 */
export const CABINETS = {
  floor: {
    id: 'floor',
    label: 'THE FLOOR MACHINE',
    jp: '街台',
    spec: 'amadeji',
    difficulty: 1,
    parts: [],
    unlock: {},
    note: 'The gentle class on a stock board. Two buckets, a legal heso, and every ' +
      'part still ahead of you.'
  },
  ippatsu: {
    id: 'ippatsu',
    label: 'IPPATSUDAI',
    jp: '一発台',
    spec: 'standard',
    difficulty: 1.10,
    parts: ['lifenails', 'lifenails', 'bucket'],
    unlock: { bestFloor: 4 },
    note: 'The "one-shot machine": a long drought and then everything at once. Starts with ' +
      'the life nails already bent 2.5 mm and a third bucket — more tickets, on a spec that ' +
      'rarely cashes one.'
  },
  hanemono: {
    id: 'hanemono',
    label: 'HANEMONO',
    jp: '羽根物',
    spec: 'amadeji',
    difficulty: 1.25,
    parts: ['tulips', 'bucket', 'widen', 'balls'],
    unlock: { bestFloor: 6 },
    note: 'The "winged machine", built around its tulips. Both are wired open from the ' +
      'first ball, which makes the scatter field a different playfield entirely.'
  },
  kenri: {
    id: 'kenri',
    label: 'KENRIMONO',
    jp: '権利物',
    spec: 'loose',
    difficulty: 1.45,
    parts: ['refund', 'refund', 'bucket', 'bucket', 'widen', 'balls'],
    unlock: { lifetimeScore: 250000 },
    note: 'The "rights machine": winning buys you the RIGHT to win, and it pays in balls ' +
      'rather than points. Half of everything the board pays comes back as another launch, ' +
      'against a wall half again as tall.'
  },
  digipachi: {
    id: 'digipachi',
    label: 'DIGIPACHI',
    jp: 'デジパチ',
    spec: 'standard',
    difficulty: 1.65,
    parts: ['combowindow', 'combowindow', 'combostep', 'bucket', 'bucket', 'widen', 'balls', 'mult'],
    unlock: { wins: 1 },
    note: 'The modern floor standard, and the one this whole simulator is modelled on. ' +
      'Chains hold nearly three seconds longer from the start and there are four mouths to ' +
      'feed them — play it fast or not at all.'
  },
  uramono: {
    id: 'uramono',
    label: 'URAMONO',
    jp: '裏物',
    spec: 'loose',
    difficulty: 2.1,
    parts: ['lifenails', 'lifenails', 'lifenails', 'warp', 'warp', 'warp', 'widen', 'widen',
      'mult', 'mult', 'bucket', 'bucket', 'bucket', 'refund', 'balls', 'bucketvalue'],
    unlock: { wins: 1, lifetimeScore: 1000000 },
    note: 'A back-room machine with the ROM swapped and every nail bent. Nothing on this ' +
      'board would pass an inspection. The wall is twice as tall and you will not notice.'
  }
}

export const CABINET_ORDER = ['floor', 'ippatsu', 'hanemono', 'kenri', 'digipachi', 'uramono']

/** Fresh meta record — what persists between runs. */
export function newMeta () {
  return { bestFloor: 0, lifetimeScore: 0, wins: 0, runs: 0, bestScore: 0, seen: [] }
}

/** Is this cabinet unlocked by the given meta record? */
export function isUnlocked (cab, meta) {
  const u = cab.unlock || {}
  if (u.bestFloor && (meta.bestFloor || 0) < u.bestFloor) return false
  if (u.lifetimeScore && (meta.lifetimeScore || 0) < u.lifetimeScore) return false
  if (u.wins && (meta.wins || 0) < u.wins) return false
  return true
}

/** Human-readable statement of what is still missing. Empty when unlocked. */
export function unlockText (cab, meta) {
  const u = cab.unlock || {}
  const want = []
  if (u.bestFloor && (meta.bestFloor || 0) < u.bestFloor) want.push(`reach floor ${u.bestFloor}`)
  if (u.wins && (meta.wins || 0) < u.wins) want.push(`clear a run`)
  if (u.lifetimeScore && (meta.lifetimeScore || 0) < u.lifetimeScore) {
    want.push(`score ${u.lifetimeScore.toLocaleString('en-US')} lifetime ` +
      `(${Math.floor(meta.lifetimeScore || 0).toLocaleString('en-US')})`)
  }
  return want.join(' · ')
}

/** Fold a finished run into the meta record. Returns the ids newly unlocked. */
export function recordRun (meta, run) {
  const before = CABINET_ORDER.filter(k => isUnlocked(CABINETS[k], meta))
  meta.runs = (meta.runs || 0) + 1
  meta.lifetimeScore = (meta.lifetimeScore || 0) + run.score
  meta.bestScore = Math.max(meta.bestScore || 0, run.score)
  meta.bestFloor = Math.max(meta.bestFloor || 0, run.floor)
  if (run.cleared) meta.wins = (meta.wins || 0) + 1
  const after = CABINET_ORDER.filter(k => isUnlocked(CABINETS[k], meta))
  return after.filter(k => !before.includes(k))
}
