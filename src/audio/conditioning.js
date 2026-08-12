// A streaming contingency ledger: what sounded, and what the payout ledger did
// afterward. It observes both channels and writes to neither.

export const CONTINGENCY_WINDOW = 0.4
export const PREDICTIVE_WINDOW = 5

const windowFor = (family) => family === 'predictive' ? PREDICTIVE_WINDOW
  : family === 'milestone' ? 0.05
    : CONTINGENCY_WINDOW

const baseChance = (pays, end, window) => {
  const intervals = pays
    .map(p => [Math.max(0, p.t - window), Math.min(end, p.t)])
    .filter(([a, b]) => b >= a)
    .sort((a, b) => a[0] - b[0])
  let covered = 0, lo = null, hi = null
  for (const [a, b] of intervals) {
    if (lo === null) { lo = a; hi = b } else if (a <= hi) hi = Math.max(hi, b)
    else { covered += hi - lo; lo = a; hi = b }
  }
  if (lo !== null) covered += hi - lo
  return Math.max(0, Math.min(1, covered / end))
}

const emptySummary = () => ({
  duration: 0, totalCues: 0, totalPays: 0, baseP: 0,
  baseByFamily: { reward: 0, mechanism: 0, predictive: 0, milestone: 0 },
  reward: { count: 0, hits: 0, rate: null, baseP: 0, delta: null },
  mechanism: { count: 0, hits: 0, rate: null, baseP: 0, delta: null },
  predictive: { count: 0, hits: 0, rate: null, baseP: 0, delta: null },
  milestone: { count: 0 }, byName: []
})

export class ConditioningLedger {
  constructor () { this.reset() }

  reset () {
    this.byName = new Map()
    this.pending = []
    this.pays = []
    this.totalCues = 0
    this.now = 0
  }

  cue ({ t = this.now, name, family = 'unknown' }) {
    if (!name) return
    this.advance(t)
    let row = this.byName.get(name)
    if (!row) this.byName.set(name, row = { name, family, count: 0, hits: 0 })
    row.count++
    this.totalCues++

    // Machine.pay emits before the pocket event in the same drained frame.
    // Treat exact co-occurrence as backed even though the observer saw pay first.
    const sameFramePay = family === 'reward' && this.pays.length &&
      Math.abs(this.pays[this.pays.length - 1].t - t) < 1e-7
    if (sameFramePay) row.hits++
    else this.pending.push({ row, t, deadline: t + windowFor(family) })
  }

  pay ({ t = this.now, n = 0, source = 'unknown' } = {}) {
    if (!(n > 0)) return
    this.advance(t)
    this.pays.push({ t, n, source })
    const keep = []
    for (const p of this.pending) {
      if (p.t <= t && t <= p.deadline) p.row.hits++
      else keep.push(p)
    }
    this.pending = keep
  }

  advance (t) {
    if (!Number.isFinite(t)) return
    this.now = Math.max(this.now, t)
    this.pending = this.pending.filter(p => p.deadline >= this.now)
  }

  summary (duration = this.now) {
    if (!this.totalCues && !this.pays.length) return emptySummary()
    const end = Math.max(duration, this.now, 1e-9)

    // A contingency is comparable only to the chance base over the SAME time
    // horizon. Reusing the 400 ms mechanism baseline for five-second
    // predictions would manufacture lift where ordinary payout density explains
    // it. Each baseline is the exact union of [pay-window, pay] intervals.
    const baseByFamily = {
      reward: baseChance(this.pays, end, CONTINGENCY_WINDOW),
      mechanism: baseChance(this.pays, end, CONTINGENCY_WINDOW),
      predictive: baseChance(this.pays, end, PREDICTIVE_WINDOW),
      milestone: baseChance(this.pays, end, 0.05)
    }
    // Backwards-compatible name for the instrument's original mechanism base.
    const baseP = baseByFamily.mechanism

    const out = {
      duration: end,
      totalCues: this.totalCues,
      totalPays: this.pays.length,
      baseP,
      baseByFamily,
      reward: { count: 0, hits: 0, rate: null, baseP: baseByFamily.reward, delta: null },
      mechanism: { count: 0, hits: 0, rate: null, baseP: baseByFamily.mechanism, delta: null },
      predictive: { count: 0, hits: 0, rate: null, baseP: baseByFamily.predictive, delta: null },
      milestone: { count: 0 },
      byName: []
    }
    for (const row of this.byName.values()) {
      const item = { ...row, rate: row.count ? row.hits / row.count : 0 }
      item.baseP = baseByFamily[row.family] ?? baseP
      item.delta = item.rate - item.baseP
      out.byName.push(item)
      const fam = out[row.family]
      if (!fam) continue
      fam.count += row.count
      if ('hits' in fam) fam.hits += row.hits
    }
    for (const family of ['reward', 'mechanism', 'predictive']) {
      const f = out[family]
      if (f.count) {
        f.rate = f.hits / f.count
        f.delta = f.rate - f.baseP
      }
    }
    out.byName.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return out
  }
}

export function formatConditioningSummary (s) {
  const pct = x => `${Math.round(100 * (Number.isFinite(x) ? x : 0))}%`
  return {
    reward: s.reward.count
      ? `${s.reward.hits}/${s.reward.count} reward cues backed by a ball payout (${pct(s.reward.rate)})`
      : 'No audible reward cues observed',
    predictive: s.predictive.count
      ? `${s.predictive.hits}/${s.predictive.count} predictive cues followed by payout within ${PREDICTIVE_WINDOW}s (${pct(s.predictive.rate)} vs ${pct(s.predictive.baseP)} base; ${s.predictive.delta >= 0 ? '+' : ''}${pct(s.predictive.delta)})`
      : 'No audible predictive cues observed',
    mechanism: s.mechanism.count
      ? `${s.mechanism.count.toLocaleString('en-US')} mechanism cues; payout contingency ${s.mechanism.delta >= 0 ? '+' : ''}${pct(s.mechanism.delta)} over the ${pct(s.baseP)} base chance`
      : 'No audible mechanism cues observed'
  }
}
