// Probe: the difficulty curve's shape, via run-sim itself.
//
// Nothing is modelled twice: this probe shells out to tools/run-sim.js
// --curve (real runs, real physics, the same auto-player every published
// number came from) and reads the same table a human would. The one claim it
// checks nightly is the ON-RAMP: floor 1's clear rate must stay ≥ 85% (the
// run-sim target band — floor 1 is the welcome, the filter is floor 2, the
// crunch floors 2–3). The full per-floor table goes into the record for a
// human's eye; clear-rate drift on later floors needs pooled nights before it
// clears this instrument's resolution, so it is recorded, not flagged.
//
// The cost column is deliberately NOT flagged at all: it is policy-dependent
// through the carry denominator (see run.js's header cautions), and an
// auto-player policy tweak would light it up with no change to the game.
export default {
  name: 'curve',
  why: 'floor-clear curve via run-sim — the on-ramp claim, re-measured',
  async run ({ depth, exec }) {
    const n = depth === 'quick' ? 6 : 16
    const r = exec(['tools/run-sim.js', '--curve', '--n', String(n)])
    const rows = [...r.out.matchAll(/^\s+(\d+)\+?\s+([\d,]+)\s+(\d+)\s+(\d+)%\s+(\d+)%/gm)]
      .map(m => ({ floor: +m[1], reached: +m[3], clear: +m[4], cost: +m[5] }))
    const anomalies = []
    if (r.timedOut) anomalies.push('run-sim timed out')
    if (rows.length === 0) {
      anomalies.push('could not parse the curve table — the probe is BLIND (did run-sim change its print format?)')
      return { summary: 'unparseable', metrics: { n }, anomalies }
    }
    const f1 = rows.find(x => x.floor === 1)
    if (!f1) anomalies.push('no floor-1 row in the table')
    else if (f1.clear < 85) anomalies.push(`floor-1 clear ${f1.clear}% at n=${n} — below the 85% on-ramp target`)
    const kept = rows.slice(0, 12)
    return {
      summary: `n=${n} · f1 clear ${f1 ? f1.clear + '%' : '?'} · floors 1–${kept.length} recorded`,
      metrics: { n, floors: kept },
      anomalies
    }
  }
}
