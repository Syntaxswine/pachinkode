// Probe: the economy, with its error bars ON.
//
// The resolution trap (SCIENCE, "Four rulings"): per-seed RTP SD at 6,000
// balls is 21–39 points — the kakuhen tail — so two few-seed snapshots
// compared as a delta will "find" a regression most weeks. This probe
// therefore reports mean ± SD every night and flags ONLY when the mean, give
// or take twice its standard error, sits entirely outside the 1-hour legal
// band (33.3%–220%). Anything subtler than that is beyond this instrument's
// resolution at this depth, and it says so instead of guessing.
//
// The record keeps every per-seed value, so a human (or a later, longer
// probe) can pool nights into the statistics one night cannot afford.
const BAND = { lo: 1 / 3, hi: 2.2 }

export default {
  name: 'economy',
  why: 'RTP per spec with honest ± — flags only outside its own resolution',
  async run ({ depth }) {
    const { runTrial } = await import('../../headless.js')
    const { SPECS } = await import('../../../src/sim/machine.js')

    const balls = depth === 'quick' ? 3000 : 6000
    const nSeeds = depth === 'quick' ? 4 : 10
    const anomalies = []
    const metrics = { balls, seeds: nSeeds, specs: {} }
    const parts = []

    for (const spec of Object.keys(SPECS)) {
      const rtps = []
      for (let s = 0; s < nSeeds; s++) {
        rtps.push(runTrial({ balls, dial: 0.20, seed: 1000 + s * 37, spec }).rtp)
      }
      const mean = rtps.reduce((a, b) => a + b, 0) / rtps.length
      const sd = Math.sqrt(rtps.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rtps.length - 1))
      const se = sd / Math.sqrt(rtps.length)
      metrics.specs[spec] = { mean: +(mean * 100).toFixed(1), sd: +(sd * 100).toFixed(1), rtps: rtps.map(r => +(r * 100).toFixed(1)) }
      parts.push(`${spec} ${(mean * 100).toFixed(0)}%±${(sd * 100).toFixed(0)}`)
      if (mean + 2 * se < BAND.lo) anomalies.push(`${spec}: RTP ${(mean * 100).toFixed(1)}% ± ${(2 * se * 100).toFixed(1)} sits entirely BELOW the 1-hour floor (33.3%)`)
      if (mean - 2 * se > BAND.hi) anomalies.push(`${spec}: RTP ${(mean * 100).toFixed(1)}% ± ${(2 * se * 100).toFixed(1)} sits entirely ABOVE the 1-hour ceiling (220%)`)
    }

    return { summary: parts.join(' · '), metrics, anomalies }
  }
}
