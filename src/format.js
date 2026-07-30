// The score formatter — one voice for every number the shell prints.
//
// The wall's summit is 1,000,000,000 by the operator's ruling, and that number
// is a SPECTACLE: it displays in full, every digit, commas and all. So does
// everything under ten trillion — thirteen digits of monospace is the widest
// the panel comfortably seats.
//
// OVERTIME is where the denomination (see run.js) runs away: quotas pass 1e15
// by floor 19 and scores reach the sextillions. Full digits there are noise,
// not information, so past 1e13 the formatter switches to the Japanese myriad
// ladder — 億 兆 京 垓 𥝱 穣 — which is the idiom this cabinet already speaks
// (抽選, 遊技, 羽). Three significant figures: an overtime score is a weather
// report, not a ledger line.
//
// Numbers this deep also pass Number.MAX_SAFE_INTEGER (~9e15): they are
// floats, honestly imprecise, and the compact display is the honest face for
// that too — printing twenty exact-looking digits of a float would be a lie.

const MYRIADS = [
  [1e28, '穣'], [1e24, '𥝱'], [1e20, '垓'], [1e16, '京'], [1e12, '兆'], [1e8, '億']
]

export function fmtScore (n) {
  n = Math.round(n)
  const a = Math.abs(n)
  if (a < 1e13 || !isFinite(n)) return n.toLocaleString('en-US')
  for (const [v, u] of MYRIADS) {
    if (a >= v) {
      const m = n / v
      return (Math.abs(m) >= 100 ? m.toFixed(1) : m.toFixed(2)) + u
    }
  }
  return n.toLocaleString('en-US')
}
