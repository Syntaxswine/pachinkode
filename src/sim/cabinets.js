// The cabinets.
//
// The mechanical cabinets use REAL classes of Japanese pachinko machine, not
// invented difficulty elements — the same discipline as SPECS in machine.js.
// TANUKIDAI and KAWADAI are explicitly picture-board identities in the 1970s
// tradition, not claims of additional regulated classes. Roguelikes hand you
// "the fire character, the ice character"; this game has an actual taxonomy
// plus authored boards, and labels the boundary between them.
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
import { MOTIFS } from './motifs.js'

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
    // The REAL winged machine now (operator's request): the `hane` spec has
    // NO digital lottery — no reels, no jackpot, no wave. The navel is a
    // mechanical trigger that works the tulip wings (two openings per entry,
    // the class's signature rhythm), the wings pay 7, and the board starts
    // carpeted in buckets. Everything this cabinet gives, it gives through
    // geometry the player can watch — which was always this class's argument
    // against the digipachi it lost the floor to.
    spec: 'hane',
    difficulty: 1.25,
    parts: ['bucket', 'bucket', 'bucket', 'bucketvalue', 'widen', 'balls'],
    unlock: { bestFloor: 6 },
    note: 'The "winged machine", and the honest one: no lottery anywhere in the cabinet. ' +
      'The navel works the wings, the wings pay, and every ball that scores was watched ' +
      'all the way in.'
  },
  tanukidai: {
    id: 'tanukidai',
    label: 'TANUKIDAI',
    jp: 'たぬき台',
    // The 1970s move (operator's design, from a Nishijin Deluxe Super
    // reference): a picture behind the nails, and the brass laid out to MATCH
    // it. The board IS the identity — the operator's ball tanuki in outline
    // nails, the heso on its literal navel (the game's start pocket has been
    // called ヘソ, the navel, since before this cabinet made it true), tulips
    // at the paw and the tail's heart, a small shrine housing for the warps,
    // and the reels pushed to the top-right margin where the old machines
    // kept their rainbow arcs. Gentle spec: this is a machine you look at.
    spec: 'amadeji',
    difficulty: 1.10,
    parts: [],
    motif: MOTIFS.tanuki,
    unlock: { bestFloor: 3 },
    note: 'A 1970s picture board. The tanuki is the layout: its navel is the navel, ' +
      'its paw and tail catch, and the lottery reads out in the corner like a marquee.'
  },
  kawadai: {
    id: 'kawadai',
    label: 'KAWADAI',
    jp: '川台',
    spec: 'amadeji',
    difficulty: 1.18,
    parts: [],
    motif: MOTIFS.kawa,
    unlock: { bestFloor: 5 },
    note: 'An original picture board in the 1970s tradition: a river festival told in brass. ' +
      'Balls enter at the source, cross an open bridge, ' +
      'circle the whirlpool navel, and spill toward the harbour through the widest clear centre ' +
      'on any cabinet.'
  },
  kenri: {
    id: 'kenri',
    label: 'KENRIMONO',
    jp: '権利物',
    spec: 'loose',
    difficulty: 1.45,
    parts: ['refund', 'refund', 'bucket', 'bucket', 'widen', 'balls'],
    // Rescaled for THE DENOMINATION (run.js): 250,000 was ~3 runs to floor 5
    // on the old face-value scale; 5,000,000 is the same journey now that
    // deep floors pay in inflated points (floor-6 cumulative ≈ 1.6M/run).
    unlock: { lifetimeScore: 5000000 },
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
    // A LIFETIME BILLION — the same number as the summit (QUOTA_TOP), and the
    // same relationship as the old 1M gate: the required win itself supplies
    // it, so the number is a boast on the card, not a second wall.
    unlock: { wins: 1, lifetimeScore: 1000000000 },
    note: 'A back-room machine with the ROM swapped and every nail bent. Nothing on this ' +
      'board would pass an inspection. The wall is twice as tall and you will not notice.'
  }
}

export const CABINET_ORDER = ['floor', 'ippatsu', 'tanukidai', 'kawadai', 'hanemono', 'kenri', 'digipachi', 'uramono']

// ── the record ──────────────────────────────────────────────────────────────
//
// Everything that survives a death. It is deliberately LOCAL — localStorage,
// this browser, no server, no account, nothing leaving the machine — which is
// the only kind of high-score table that fits a game whose whole argument is
// about what a machine does to the person in front of it.
//
// `records` keeps the best RUNS_KEPT runs in full rather than just a number,
// because a score with no context is the least interesting thing about a run.
// Which cabinet, how deep, how long the best chain ran, how many parts were
// fitted — that is a record somebody can read and want to beat specifically.

/** How many individual runs the table remembers. */
export const RUNS_KEPT = 10

/** Fresh meta record — what persists between runs. */
export function newMeta () {
  return {
    bestFloor: 0,
    lifetimeScore: 0,
    wins: 0,
    runs: 0,
    bestScore: 0,
    bestChain: 0,
    lifetimeBalls: 0,
    records: [],       // [{score, floor, cab, cleared, parts, chain, at}] — best first
    perCab: {},        // cab → {best, runs, cleared, bestFloor}
    seen: []
  }
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

/**
 * Fold a finished run into the meta record. Returns the ids newly unlocked.
 *
 * `at` is passed in rather than read from the clock here, so this stays a pure
 * function of its inputs and the tests do not have to freeze time.
 */
export function recordRun (meta, run, at = null) {
  const before = CABINET_ORDER.filter(k => isUnlocked(CABINETS[k], meta))
  const cab = (run.cabinet && run.cabinet.id) || 'floor'

  meta.runs = (meta.runs || 0) + 1
  meta.lifetimeScore = (meta.lifetimeScore || 0) + run.score
  meta.bestScore = Math.max(meta.bestScore || 0, run.score)
  meta.bestFloor = Math.max(meta.bestFloor || 0, run.floor)
  meta.bestChain = Math.max(meta.bestChain || 0, run.bestChain || 0)
  if (run.cleared) meta.wins = (meta.wins || 0) + 1

  // Per-cabinet, because "my best" on the stock machine and on URAMONO are not
  // remotely the same claim — the quota multiplier alone is 2.1×.
  meta.perCab = meta.perCab || {}
  const pc = meta.perCab[cab] || (meta.perCab[cab] = { best: 0, runs: 0, cleared: 0, bestFloor: 0 })
  pc.runs++
  pc.best = Math.max(pc.best, run.score)
  pc.bestFloor = Math.max(pc.bestFloor, run.floor)
  if (run.cleared) pc.cleared++

  meta.records = meta.records || []
  meta.records.push({
    score: Math.round(run.score),
    floor: run.floor,
    cab,
    cleared: !!run.cleared,
    parts: (run.loadout && run.loadout.parts.length) || 0,
    chain: run.bestChain || 0,
    at
  })
  meta.records.sort((a, b) => b.score - a.score)
  meta.records.length = Math.min(meta.records.length, RUNS_KEPT)

  const after = CABINET_ORDER.filter(k => isUnlocked(CABINETS[k], meta))
  return after.filter(k => !before.includes(k))
}
