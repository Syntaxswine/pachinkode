// Probe: ball traps, both ways — the wedge hunt.
//
// loadout-audit.js is the repo's one true GATE (exit 1 when any buildable
// board contains a trap). The canary RUNS the gate and reports its verdict
// without adopting its exit code — law 1: this process never gates. A trap
// found at night is an annotation for the morning, and the record shows
// exactly which night it appeared.
//
// board-audit.js (the stock board's human-readable report) runs too, and its
// raw text rides along in the record, because the wall-vs-wall pinches it
// lists are for a human to move — the audit's own header says so.
export default {
  name: 'boards',
  why: 'runs the loadout-audit gate + stock board report, annotates the verdict',
  async run ({ exec }) {
    const gate = exec(['tools/loadout-audit.js'])
    const stock = exec(['tools/board-audit.js'])
    const anomalies = []
    if (gate.timedOut) anomalies.push('loadout-audit timed out')
    else if (gate.code !== 0) {
      const tail = gate.out.trim().split('\n').slice(-6).join(' · ')
      anomalies.push(`loadout-audit GATE FAILED (exit ${gate.code}): ${tail}`)
    }
    if (stock.timedOut) anomalies.push('board-audit timed out')
    return {
      summary: gate.code === 0 ? 'gate clean · stock board reported' : 'GATE FAILED',
      metrics: { gateExit: gate.code },
      raw: { boardAudit: stock.out.slice(0, 4000) },
      anomalies
    }
  }
}
