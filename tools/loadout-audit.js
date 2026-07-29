// Sweep the wedge audit across the space of boards a run can actually build.
//
//   node tools/loadout-audit.js            # the systematic sweep
//   node tools/loadout-audit.js --random 400
//   node tools/loadout-audit.js --verbose
//
// ── WHY THIS TOOL EXISTS ────────────────────────────────────────────────────
//
// Before the roguelike there was one board, and one run of tools/board-audit.js
// covered it completely. Now the board is a function of the loadout: seven
// bucket sites × four widening steps × three life-nail bends × three warp
// widths × sticky tulips, plus six cabinets' worth of starting parts. That is
// several thousand distinct playfields, and the failure they share is the one
// this project has spent its entire life on — a gap wider than nothing and
// narrower than an 11 mm ball, which swallows balls silently and shows up only
// as a statistic that will not reconcile.
//
// A player will reach a board no human ever looked at. This is how it gets
// looked at anyway.
//
// EXIT CODE: 1 if any board has a trap. Unlike board-audit.js, this one IS a
// gate — board-audit reports on a board a human chose and may legitimately
// contain an unreachable narrow gap, while a finding here means a part
// combination the game will hand out unprompted builds a broken machine.

import { buildBoard } from '../src/sim/board.js'
import { baseLoadout, resolveLoadout, PARTS, SITE_ORDER, BUCKET_SITES } from '../src/sim/loadout.js'
import { CABINETS, CABINET_ORDER } from '../src/sim/cabinets.js'
import { makeRng } from '../src/sim/rng.js'
import { scanPinches, scanNailPinches, scanRotorPinches, blockedPockets } from './lib/pinch.js'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const num = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : +argv[i + 1] }
const VERBOSE = flag('verbose')

let checked = 0
let broken = 0
const failures = []

function check (label, partIds, motif = null) {
  let built
  try {
    built = buildBoard(resolveLoadout(partIds, null, motif))
  } catch (e) {
    // A thrown build is a PASS for the wedge question and a FAIL for the game:
    // it means a site could not be placed legally. Report it as broken, because
    // the player would have seen a crash.
    broken++
    failures.push({ label, partIds, why: e.message, kind: 'throw' })
    checked++
    return
  }
  const { world, parts } = built
  const walls = [...scanPinches(world), ...scanRotorPinches(world, parts)]
  const nails = scanNailPinches(world, parts)
  // A pocket nothing can reach is not a trap, but it IS a broken part: the
  // player was offered a bucket, paid a draft pick for it, and got a hole in a
  // sealed box. The position probe reported those as perfectly clean boards,
  // which is exactly the kind of quiet pass an instrument has to be taught to
  // stop giving.
  const unreached = blockedPockets(world, parts)
  checked++
  if (walls.length || nails.length || unreached.length) {
    broken++
    failures.push({ label, partIds, walls, nails, unreached, kind: 'pinch' })
  } else if (VERBOSE) {
    console.log(`    ok  ${label}  (${world.nails.length} nails, ${parts.buckets.length} buckets)`)
  }
}

console.log('\n  PACHINKODE loadout audit — every board a run can build\n')

// ── 1. the stock board, and each part alone, at every stack depth ───────────
//
// Single-part stacks first, because a failure here localises instantly to one
// part. A failure only in a combination is a much slower thing to read, so the
// cheap unambiguous cases go first.
console.log('  single parts, stacked to their maximum')
check('stock', [])
for (const p of PARTS) {
  const ids = []
  for (let n = 1; n <= (p.max || 1); n++) {
    ids.push(p.id)
    check(`${p.id} ×${n}`, [...ids])
  }
}

// ── 2. every bucket count against every widening step ───────────────────────
//
// The interaction that actually bites. Widening moves every cup's walls
// outward at once, so the dangerous configuration is not "many buckets" or
// "wide mouths" but the corner where both are maximal and two adjacent sites'
// outer walls approach each other — or, as the very first sweep found, where a
// single west bucket's wall converges on the launch rail.
console.log('  bucket count × mouth width')
const widenMax = PARTS.find(p => p.id === 'widen').max
for (let b = 0; b <= SITE_ORDER.length; b++) {
  for (let w = 0; w <= widenMax; w++) {
    check(`${b} buckets, widen ×${w}`,
      [...Array(b).fill('bucket'), ...Array(w).fill('widen')])
  }
}

// ── 3. every cabinet's starting board ───────────────────────────────────────
console.log('  cabinets, as dealt')
// The motif travels with the cabinet — the gate must audit the board the
// player actually gets, not the standard grid wearing the cabinet's parts
// (the census's headline finding: a motif cabinet was otherwise INVISIBLE
// to this gate).
for (const key of CABINET_ORDER) check(`cabinet:${key}`, CABINETS[key].parts || [], CABINETS[key].motif || null)

// ── 4. every cabinet, fully built out ───────────────────────────────────────
//
// The end state of a won run: every part stacked to its cap on top of whatever
// the cabinet already had. This is the board a player who clears URAMONO is
// standing in front of, and nobody would ever construct it by hand.
console.log('  cabinets, maxed out')
for (const key of CABINET_ORDER) {
  const ids = [...(CABINETS[key].parts || [])]
  for (const p of PARTS) for (let n = 0; n < (p.max || 1); n++) ids.push(p.id)
  check(`cabinet:${key} MAXED`, ids, CABINETS[key].motif || null)
}

// ── 5. random walks ─────────────────────────────────────────────────────────
//
// The systematic passes above cover the corners. A real run is a path through
// the middle of the space, taking whatever the draft offered, and the middle is
// where an interaction nobody predicted lives. Seeded, so a failure reproduces.
const N = num('random', 200)
console.log(`  ${N} random draft paths`)
for (let s = 0; s < N; s++) {
  const rng = makeRng(s + 1)
  const L = baseLoadout()
  const ids = []
  const depth = 4 + Math.floor(rng() * 18)
  for (let k = 0; k < depth; k++) {
    const pool = PARTS.filter(p =>
      (!p.max || ids.filter(i => i === p.id).length < p.max) &&
      (!p.available || p.available(L)))
    if (!pool.length) break
    const p = pool[Math.floor(rng() * pool.length)]
    p.apply(L)
    ids.push(p.id)
  }
  check(`random seed ${s + 1} (${ids.length} parts)`, ids)
}

// ── the report ──────────────────────────────────────────────────────────────

console.log(`\n  ${checked} boards built · ${broken} with traps\n`)

if (!failures.length) {
  const sites = Object.keys(BUCKET_SITES).length
  console.log(`  Clean. Every reachable board is playable: ${sites} bucket sites, ` +
    `every widening step, every cabinet, ${N} random paths.\n`)
  process.exit(0)
}

for (const f of failures.slice(0, 24)) {
  console.log(`  ✗ ${f.label}`)
  console.log(`      parts: ${f.partIds.join(', ') || '(none)'}`)
  if (f.kind === 'throw') {
    console.log(`      THREW: ${f.why}\n`)
    continue
  }
  for (const w of (f.walls || []).slice(0, 4)) {
    console.log(`      ${(w.gap * 1000).toFixed(1)} mm wall pinch at ` +
      `(${w.x.toFixed(3)}, ${w.y.toFixed(3)})   ${w.a} ↔ ${w.b}`)
  }
  for (const u of (f.unreached || [])) {
    console.log(`      BLOCKED bucket: ${u} — its mouth has no clear descent above it`)
  }
  for (const n of (f.nails || []).slice(0, 4)) {
    console.log(`      ${(n.gap * 1000).toFixed(1)} mm NAIL pinch at ` +
      `(${n.a.x.toFixed(3)}, ${n.a.y.toFixed(3)})`)
  }
  console.log('')
}
if (failures.length > 24) console.log(`  …and ${failures.length - 24} more.\n`)
console.log('  A ball that reaches one of these stops there for good. Move the site, ' +
  'lower the widening ceiling, or close the gap entirely.\n')
process.exit(1)
