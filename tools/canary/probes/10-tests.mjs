// Probe: the pinned laws. Runs the whole suite (the 110 tests are the repo's
// case law — every ruling, every review finding, every trap has a pin here)
// and parses the TAP summary. A parse failure is reported as BLINDNESS, not
// silence: an instrument that cannot read its own gauge must say so.
export default {
  name: 'tests',
  why: 'the pinned laws — every ruling and review finding has a test here',
  async run ({ exec }) {
    const r = exec(['--test', '--test-reporter', 'tap', 'test/**/*.test.js'])
    const pass = +(r.out.match(/^# pass (\d+)/m)?.[1] ?? NaN)
    const fail = +(r.out.match(/^# fail (\d+)/m)?.[1] ?? NaN)
    const anomalies = []
    if (Number.isNaN(pass) || Number.isNaN(fail)) {
      anomalies.push('could not parse the TAP summary — the probe is BLIND, which is not the same as the suite being green')
    } else if (fail > 0) {
      const failing = [...r.out.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]).slice(0, 8)
      anomalies.push(`${fail} failing test(s): ${failing.join(' · ')}`)
    }
    if (r.timedOut) anomalies.push('the suite timed out')
    return {
      summary: Number.isNaN(pass) ? 'unparseable' : `${pass} pass · ${fail} fail`,
      metrics: { pass, fail },
      anomalies
    }
  }
}
