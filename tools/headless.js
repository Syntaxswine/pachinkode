// Run the machine with no canvas, no audio, no player. This is the instrument:
// every balance claim in the docs should be reproducible by running it.
//
//   node tools/headless.js --balls 3000 --dial 0.35 --seed 7
//   node tools/headless.js --sweep                     # dial sweep, landing histogram
//   node tools/headless.js --threshold                 # find the route boundary

import { Machine, LAUNCH_INTERVAL, SPECS } from '../src/sim/machine.js'
import { buildBoard, thresholdCrestSpeed } from '../src/sim/board.js'
import { DT } from '../src/sim/world.js'

const args = parseArgs(process.argv.slice(2))

/**
 * Fire `balls` balls at a fixed dial and tally everything.
 * The machine is given effectively unlimited tokens so the run is not cut short
 * by the economy; the economy is measured separately by tools/calibrate.js.
 */
export function runTrial ({ balls = 500, dial = 0.5, seed = 1, spec = 'amadeji', live = 1, auto = true } = {}) {
  const m = new Machine({ seed, spec, tokens: balls + 10 })
  m.dial = dial
  m.firing = true
  // A competent player cranks the dial over the threshold the moment the attacker
  // opens, because the attacker is only reachable on the right-hand route. Holding
  // one dial setting through a jackpot throws most of it away — measured at fixed
  // dial 0.30, three jackpots yielded 23 attacker entries out of a possible 162.
  // Modelling the switch is what makes the RTP figure mean anything.
  const MIGI = 0.88
  const tally = {}
  const stuckAt = []
  let hits = 0, settled = 0, guard = 0
  const maxSteps = balls * 40000 / (live || 1)

  const bump = (k) => { tally[k] = (tally[k] || 0) + 1 }

  while (guard < maxSteps) {
    guard++
    // Stop launching once the quota is out, then let the board finish draining.
    if (m.launched >= balls) m.firing = false
    if (auto) m.dial = m.inJackpot ? MIGI : dial
    m.step(DT)
    for (const ev of m.drain()) {
      switch (ev.type) {
        case 'hit': hits++; break
        case 'heso': bump('heso'); settled++; break
        case 'tulip': bump('tulip'); settled++; break
        case 'attacker': bump('attacker'); settled++; break
        case 'warp': bump('warp'); break
        case 'foul': bump('foul'); settled++; break
        case 'drain':
          bump(ev.kind === 'stuck' ? 'stuck' : 'out')
          if (ev.kind === 'stuck') {
            stuckAt.push({
              x: +ev.x.toFixed(4), y: +ev.y.toFixed(4),
              v: +Math.hypot(ev.ball.vx, ev.ball.vy).toFixed(3),
              hits: ev.ball.hits
            })
          }
          settled++
          break
      }
    }
    if (!m.firing && m.world.balls.length === 0 && m.launched >= balls) break
  }
  return {
    tally, settled, stuckAt, hits, machine: m,
    launched: m.launched,
    meanHits: settled ? hits / settled : 0,
    rtp: m.rtp, spins: m.spins, jackpots: m.jackpots
  }
}

function parseArgs (argv) {
  const o = { balls: 400, dial: 0.5, seed: 1, spec: 'amadeji', sweep: false, threshold: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sweep') o.sweep = true
    else if (a === '--threshold') o.threshold = true
    else if (a.startsWith('--')) o[a.slice(2)] = isNaN(+argv[i + 1]) ? argv[++i] : +argv[++i]
  }
  return o
}

const bar = (frac, width = 26) => '█'.repeat(Math.round(frac * width)) + '·'.repeat(width - Math.round(frac * width))

function sweep () {
  console.log(`\n  spec: ${SPECS[args.spec].label}   ${args.balls} balls per row, seed ${args.seed}`)
  console.log('\n  dial    heso   tulip  attack    warp    foul     out   stuck   ⌀hits')
  console.log('  ' + '─'.repeat(70))
  const allStuck = []
  for (let p = 0; p <= 1.0001; p += 0.1) {
    const r = runTrial({ balls: args.balls, dial: p, seed: args.seed, spec: args.spec })
    const f = (k) => ((r.tally[k] || 0) / Math.max(1, r.settled) * 100).toFixed(1).padStart(7)
    allStuck.push(...r.stuckAt)
    console.log(`  ${p.toFixed(2)} ${f('heso')} ${f('tulip')} ${f('attacker')} ${f('warp')} ${f('foul')} ${f('out')} ${f('stuck')}  ${r.meanHits.toFixed(1)}`)
  }
  if (allStuck.length) {
    console.log(`\n  ${allStuck.length} stuck. Clusters (2 cm bins):`)
    const bins = new Map()
    for (const s of allStuck) {
      const k = `${(Math.round(s.x / 0.02) * 0.02).toFixed(2)},${(Math.round(s.y / 0.02) * 0.02).toFixed(2)}`
      bins.set(k, (bins.get(k) || 0) + 1)
    }
    for (const [k, v] of [...bins].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    (${k})  ×${v}`)
  }
  console.log()
}

/**
 * Locate the route boundary empirically and check it against the closed form.
 * The board's header claims the split between left-hitting and right-hitting
 * falls out of v²/R ≥ g·sinθ; this is the measurement that keeps that claim honest.
 */
function threshold () {
  const { world } = buildBoard()
  console.log(`\n  predicted crest speed at the inner rail's end: ${thresholdCrestSpeed().toFixed(3)} m/s`)
  console.log('\n  dial   right-route share   (balls passing x > 0.33 above y = 0.25)')
  console.log('  ' + '─'.repeat(62))
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const m = new Machine({ seed: args.seed, tokens: 200 })
    m.dial = p; m.firing = true
    const seen = new Map()
    let right = 0, total = 0, guard = 0
    while (m.launched < 120 && guard < 4e6) {
      guard++
      m.step(DT)
      for (const b of m.world.balls) {
        if (b.warped) continue
        if (!seen.has(b.id)) { seen.set(b.id, false); total++ }
        if (!seen.get(b.id) && b.x > 0.33 && b.y < 0.25) { seen.set(b.id, true); right++ }
      }
      for (const ev of m.drain()) { if (ev.type === 'foul') total-- }
    }
    const share = total > 0 ? right / total : 0
    console.log(`  ${p.toFixed(2)}   ${(share * 100).toFixed(0).padStart(3)}%  ${bar(share)}`)
  }
  console.log()
}

function single () {
  const r = runTrial({ balls: args.balls, dial: args.dial, seed: args.seed, spec: args.spec })
  const m = r.machine
  console.log(`\n  ${SPECS[args.spec].label} — ${r.launched} balls at dial ${args.dial}, seed ${args.seed}`)
  console.log(`  ${r.meanHits.toFixed(1)} nail strikes per ball · ${m.spins} spins · ${m.jackpots} jackpots`)
  console.log(`  spent ${m.spent}  won ${m.won}  RTP ${(m.rtp * 100).toFixed(1)}%`)
  console.log(`  wall-clock equivalent: ${(r.launched * LAUNCH_INTERVAL / 60).toFixed(1)} min at the legal 100 balls/min\n`)
  const total = Math.max(1, r.settled)
  for (const [k, v] of Object.entries(r.tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(9)} ${String(v).padStart(6)}  ${(v / total * 100).toFixed(1).padStart(5)}%  ${bar(v / total)}`)
  }
  console.log()
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (invoked) {
  if (args.sweep) sweep()
  else if (args.threshold) threshold()
  else single()
}
