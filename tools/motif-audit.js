// The motif acceptance instrument — a GATE (exit 1), like loadout-audit.
//
//   node tools/motif-audit.js                # every motif cabinet
//   node tools/motif-audit.js --cab tanukidai --quick
//
// Born from an adversarial review that confirmed two reachable ball traps and
// three dead pockets on the first motif board, every one of them in a state
// the existing gates never built:
//
//   - loadout-audit built motif boards only AS-DEALT and MAXED. The traps
//     lived in between (bucket ×4 without STUCK TULIPS at widen 0–3), and
//     MAXED's sticky-open pose masked a closed-wing pinch. This gate builds
//     the INTERMEDIATE LADDER: buckets 2..4 × widen 0..3 × sticky on/off.
//   - the wedge sweep exempts protected nails (life nails, the right-route
//     ladder), and nothing re-checked them against WALLS — a relocated cup
//     parked balls on a 7 mm nail cradle for 40 s and confiscated them. This
//     gate scans protected nails against every wall in the kill band.
//   - furniture vs the windmills' SWEPT DISCS: both tanuki tulips sat inside
//     blade reach. No scanner saw rotors vs tulip wings. This gate does.
//   - pockets can be geometrically clean and MEASURED-DEAD (the westHigh
//     sin, loadout.js's own documented law). This gate drum-fires the real
//     machine and demands every startable site and tulip actually feed.
//
// The dynamic thresholds are deliberately low bars (a pocket must merely be
// ALIVE, not balanced) — balance stays the operator's dial; deadness is a
// defect. Same law as everywhere: measured, or not claimed.

import { buildBoard, applyTulip } from '../src/sim/board.js'
import { resolveLoadout, PARTS, SITE_ORDER } from '../src/sim/loadout.js'
import { CABINETS, CABINET_ORDER } from '../src/sim/cabinets.js'
import { Machine } from '../src/sim/machine.js'
import { DT } from '../src/sim/world.js'
import { closestOnSegment } from '../src/sim/vec.js'
import { scanPinches, scanRotorPinches, blockedPockets, DANGER_LO, DANGER_HI } from './lib/pinch.js'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const QUICK = flag('quick')

const failures = []
const note = (cab, label, why) => failures.push({ cab, label, why })

/** Protected nails (sweep-exempt) vs every wall: the cradle class. */
function scanProtectedNailWalls (world, parts) {
  const out = []
  const prot = [...(parts.lifeNails || []), ...(parts.featureNails || [])]
  for (const n of prot) {
    for (const s of world.segments) {
      const c = closestOnSegment(n, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by })
      const gap = Math.hypot(n.x - c.x, n.y - c.y) - n.r - s.r
      // The life nails' whole job is a sub-ball gap against the heso walls;
      // exempt a protected nail's OWN pocket exactly as the pinch scan does.
      if (s.id && /heso/.test(s.id) && parts.lifeNails && parts.lifeNails.includes(n)) continue
      if (gap > 0.0108 && gap < 0.0128) {
        out.push(`protected nail at (${n.x.toFixed(3)}, ${n.y.toFixed(3)}) sits ${(gap * 1000).toFixed(1)}mm from ${s.id || 'wall'} — sweep-exempt cradle`)
      }
    }
  }
  return out
}

/** Tulip wings (both poses) vs windmill swept discs. */
function scanTulipsVsRotors (parts) {
  const out = []
  for (const t of parts.tulips || []) {
    for (const pose of [0, 1]) {
      t.open = pose === 1
      applyTulip(t, 1)
      for (const seg of [t.segL, t.segR]) {
        for (const ro of parts.rotors || []) {
          const c = closestOnSegment({ x: ro.x, y: ro.y }, { x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by })
          const gap = Math.hypot(ro.x - c.x, ro.y - c.y) - ro.r - seg.r - 0.0022
          if (gap < 0.0128) {
            out.push(`${t.id} wing ${pose ? 'open' : 'closed'} within ${(Math.max(0, gap) * 1000).toFixed(1)}mm of a windmill's swept disc`)
          }
        }
      }
    }
    t.open = !!t.sticky
    applyTulip(t, 1)
  }
  return [...new Set(out)]
}

function staticPass (cab) {
  const motif = cab.motif
  // The intermediate ladder: the states loadout-audit's dealt/MAXED bracket
  // skips, which is where the review's traps lived.
  const ladders = []
  for (let buckets = 0; buckets <= 4; buckets++) {
    for (let widen = 0; widen <= 3; widen++) {
      for (const sticky of [false, true]) {
        const ids = [...(cab.parts || []),
          ...Array(buckets).fill('bucket'),
          ...Array(widen).fill('widen'),
          ...(sticky ? ['tulips'] : [])]
        ladders.push({ label: `b${buckets} w${widen}${sticky ? ' sticky' : ''}`, ids })
      }
    }
  }
  for (const { label, ids } of (QUICK ? ladders.filter((_, i) => i % 4 === 0) : ladders)) {
    let built
    try {
      built = buildBoard(resolveLoadout(ids, null, motif))
    } catch (e) { note(cab.id, label, 'THROW: ' + e.message.slice(0, 100)); continue }
    const { world, parts } = built
    for (const p of [...scanPinches(world), ...scanRotorPinches(world, parts)]) {
      note(cab.id, label, `${(p.gap * 1000).toFixed(1)}mm wall pinch ${p.a} ~ ${p.b}`)
    }
    for (const b of blockedPockets(world, parts)) note(cab.id, label, `BLOCKED ${JSON.stringify(b)}`)
    for (const w of scanProtectedNailWalls(world, parts)) note(cab.id, label, w)
    for (const w of scanTulipsVsRotors(parts)) note(cab.id, label, w)
  }
}

/**
 * Drum-fire the real machine and demand life from every organ. Thresholds
 * are deliberately generous floors — this is a deadness detector, not a
 * balance instrument. Two dials, because the two routes feed different sides.
 */
function dynamicPass (cab) {
  const motif = cab.motif
  const ids = [...(cab.parts || []), ...SITE_ORDER.map(() => 'bucket').slice(0, 4)]
  const L = resolveLoadout(ids, null, motif)
  const balls = QUICK ? 1200 : 3000
  const tally = { }
  for (const dial of [0.20, 0.30]) {
    for (const seed of [11, 47]) {
      const m = new Machine({ seed, tokens: balls + 10, fireInterval: 0.2, loadout: L })
      m.dial = dial
      m.firing = true
      let guard = 0
      while (m.launched < balls / 4 && guard++ < 3e6) {
        m.step(DT)
        for (const ev of m.drain()) {
          if (ev.type === 'bucket') tally['bucket:' + ev.site] = (tally['bucket:' + ev.site] || 0) + 1
          else if (ev.type === 'tulip') tally['tulip:' + ev.id] = (tally['tulip:' + ev.id] || 0) + 1
          else if (ev.type === 'heso') tally.heso = (tally.heso || 0) + 1
          else if (ev.type === 'warp') tally.warp = (tally.warp || 0) + 1
        }
      }
    }
  }
  const per1k = (k) => 1000 * (tally[k] || 0) / balls
  if (per1k('heso') < 3) note(cab.id, 'dynamic', `heso ${per1k('heso').toFixed(1)}/1k — the corridor starves the navel`)
  for (const t of (motif.tulips || [])) {
    if (per1k('tulip:' + t.id) < 1) note(cab.id, 'dynamic', `${t.id} ${per1k('tulip:' + t.id).toFixed(1)}/1k — a dead wing (the westHigh sin)`)
  }
  for (const site of L.buckets.map(b => b.site)) {
    if (per1k('bucket:' + site) < 0.7) note(cab.id, 'dynamic', `bucket ${site} ${per1k('bucket:' + site).toFixed(2)}/1k — a dead draft pick (the westHigh sin)`)
  }
  return tally
}

console.log('\n  MOTIF ACCEPTANCE — the states the other gates skip\n')
const only = arg('cab', null)
let ran = 0
for (const key of CABINET_ORDER) {
  const cab = CABINETS[key]
  if (!cab.motif) continue
  if (only && key !== only) continue
  ran++
  console.log(`  ${cab.label} (${cab.motif.id})`)
  staticPass(cab)
  const tally = dynamicPass(cab)
  const rows = Object.entries(tally).sort((a, b) => b[1] - a[1])
  console.log('    feed: ' + rows.map(([k, v]) => `${k} ${v}`).join(' · '))
}
if (!ran) { console.log('  no motif cabinets to audit'); process.exit(0) }

if (failures.length) {
  console.log(`\n  ${failures.length} FAILURE(S):`)
  for (const f of failures) console.log(`    ✗ [${f.cab} ${f.label}] ${f.why}`)
  console.log()
  process.exit(1)
}
console.log('\n  clean: every ladder state, every protected nail, every organ alive.\n')
