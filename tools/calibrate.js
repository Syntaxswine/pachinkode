// Measure the machine's economy and check it against the regulation.
//
//   node tools/calibrate.js                  # all specs, default depth
//   node tools/calibrate.js --balls 20000 --seeds 5
//
// The Japanese type test fires balls at a machine and measures the ratio
// returned, over three windows with three different legal bands:
//
//     1 hour   (6,000 balls)   payout must land in  33.3% – 220%
//     4 hours  (24,000 balls)                       40%   – 150%
//     10 hours (60,000 balls)                       50%   – 133.3%
//
// Note the shape: the *shorter* the window, the *wider* the permitted swing.
// The regulation is constraining variance, not just the mean. This tool
// reproduces that structure — a single mean RTP would hide exactly the thing
// the regulator cared about.
//
// (The 10-hour ceiling is 4/3, not 3/4. Several English sources render it the
// wrong way up, which inverts the meaning of the most important number here.)

import { runTrial } from './headless.js'
import { SPECS, chainLength, LAUNCH_INTERVAL, HESO_PAY, TULIP_PAY } from '../src/sim/machine.js'

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = isNaN(+process.argv[i + 1]) ? process.argv[++i] : +process.argv[++i]
}
const BALLS = args.balls || 6000
const SEEDS = args.seeds || 4
// 0.20 is where the dial sweep peaks — the setting a competent player converges
// on. Measuring anywhere else understates the machine: at 0.30 the heso rate is
// 1.2%, at 0.20 it is 2.9%, and above 0.40 the left route stops feeding the start
// pocket entirely. Report the machine as played, not as an average over settings
// nobody uses.
const DIAL = args.dial ?? 0.20

const BANDS = [
  { hours: 1, balls: 6000, lo: 1 / 3, hi: 2.2 },
  { hours: 4, balls: 24000, lo: 0.40, hi: 1.5 },
  { hours: 10, balls: 60000, lo: 0.50, hi: 4 / 3 }
]

const pct = (x) => (x * 100).toFixed(1) + '%'

function analyse (specName) {
  const S = SPECS[specName]
  const rows = []
  for (let s = 0; s < SEEDS; s++) {
    const r = runTrial({ balls: BALLS, dial: DIAL, seed: 1000 + s * 37, spec: specName })
    const m = r.machine
    const n = r.launched || 1
    rows.push({
      rtp: m.rtp,
      heso: (r.tally.heso || 0) / n,
      tulip: (r.tally.tulip || 0) / n,
      warp: (r.tally.warp || 0) / n,
      foul: (r.tally.foul || 0) / n,
      base: ((r.tally.heso || 0) * HESO_PAY + (r.tally.tulip || 0) * TULIP_PAY) / n,
      spins: m.spins,
      jackpots: m.jackpots,
      hits: r.meanHits
    })
  }
  const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length
  const sd = (k) => {
    const mu = mean(k)
    return Math.sqrt(rows.reduce((a, r) => a + (r[k] - mu) ** 2, 0) / Math.max(1, rows.length - 1))
  }

  console.log(`\n  ${S.label}   ${S.note}`)
  console.log('  ' + '─'.repeat(68))
  console.log(`    jackpot odds      1/${S.jackpotOdds}   kakuhen 1/${S.kakuhenOdds} for ${S.stSpins} spins`)
  const catchP = 1 - Math.pow(1 - 1 / S.kakuhenOdds, S.stSpins)
  console.log(`    ST catch          ${pct(catchP)}   ×${pct(S.kakuhenChance)} entry  →  mean chain ${chainLength(S).toFixed(2)} jackpots`)
  console.log(`    max per jackpot   ${S.rounds * S.entriesPerRound * S.payPerEntry} balls  (legal ceiling 1500)`)
  console.log()
  console.log(`    measured over ${SEEDS} × ${BALLS} balls at dial ${DIAL}:`)
  console.log(`      RTP             ${pct(mean('rtp'))}  ± ${pct(sd('rtp'))}`)
  console.log(`      base (no ōatari)${pct(mean('base')).padStart(7)}   real machines sit near 30%`)
  console.log(`      heso rate       ${pct(mean('heso'))}   tulip ${pct(mean('tulip'))}   warp ${pct(mean('warp'))}`)
  console.log(`      foul rate       ${pct(mean('foul'))}`)
  console.log(`      nail strikes    ${mean('hits').toFixed(1)} per ball`)
  console.log(`      spins ${Math.round(mean('spins'))}   jackpots ${mean('jackpots').toFixed(1)}`)

  const band = BANDS.reduce((best, b) =>
    Math.abs(b.balls - BALLS) < Math.abs(best.balls - BALLS) ? b : best)
  const ok = mean('rtp') >= band.lo && mean('rtp') <= band.hi
  console.log(`\n      nearest type-test window: ${band.hours} h (${band.balls} balls), legal ${pct(band.lo)}–${pct(band.hi)}`)
  console.log(`      ${ok ? 'PASS' : 'OUT OF BAND'}  measured ${pct(mean('rtp'))}`)
  return { specName, rtp: mean('rtp'), ok, base: mean('base') }
}

console.log(`\n  PACHINKODE economy calibration`)
console.log(`  ${BALLS} balls × ${SEEDS} seeds per spec  ≈ ${(BALLS * LAUNCH_INTERVAL / 3600).toFixed(1)} h of play each`)

const results = []
for (const name of Object.keys(SPECS)) results.push(analyse(name))

console.log('\n  ' + '═'.repeat(68))
for (const r of results) {
  console.log(`  ${r.ok ? '  OK ' : ' FAIL'}  ${r.specName.padEnd(10)} RTP ${pct(r.rtp).padStart(7)}   base ${pct(r.base).padStart(7)}`)
}
console.log()
process.exit(results.every(r => r.ok) ? 0 : 1)
