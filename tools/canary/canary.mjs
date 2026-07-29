// THE CANARY — pachinkode's dedicated testing software.
//
//   node tools/canary/canary.mjs             # full nightly depth
//   node tools/canary/canary.mjs --quick     # reduced depth, minutes not tens of minutes
//   node tools/canary/canary.mjs --probe economy
//   node tools/canary/canary.mjs --list
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────
//
// The operator asked for testing software that is "modular and can run in the
// background". This is it, built to the precedent of vugg-canary: a sweep of
// PROBES that each measure one thing the repo has promised, run on a schedule
// or by hand, accreting a record.
//
// ── THE LAWS ────────────────────────────────────────────────────────────────
//
// 1. PASSIVE INSTRUMENT, NEVER A GATE. This process exits 0 no matter what it
//    finds. It annotates — '⚠' lines and a record entry — and a human decides.
//    A monitoring tool that halts becomes a thing people route around, and a
//    record with gaps where the interesting nights were is worthless.
//    (loadout-audit stays a gate; the canary RUNS the gate and reports its
//    verdict without adopting its exit code.)
//
// 2. HARD INVARIANTS BEFORE STATISTICS. The bug that trapped a previous
//    builder — negative dt integrating the sim backwards — presented as the
//    channel jam, a real mechanic, and hid behind that story for minutes. The
//    number that would have named it instantly was `sinceLaunch = −2.383 s`:
//    an invariant, violated. So the invariants probe runs first, and when a
//    statistical probe flags something, check the invariants line before
//    building a story about mechanics.
//
// 3. HONEST ERROR BARS. Per-seed RTP SD at 6,000 balls is 21–39 points (the
//    kakuhen tail). A probe that compared single runs night-to-night would
//    "find" a regression weekly. Every statistical probe here carries its own
//    spread and flags only what its resolution can actually support; a probe
//    that cannot parse or cannot resolve says it is BLIND, which is an
//    anomaly — an instrument must refuse noise shaped like an answer.
//
// 4. MODULAR. A probe is one file in probes/ exporting
//    { name, why, run(ctx) → { summary, metrics, anomalies, [raw] } }.
//    Files run in name order (hence the numeric prefixes). Add a probe by
//    adding a file; the runner needs no edit.
//
// ── THE RECORD ──────────────────────────────────────────────────────────────
//
// Every sweep appends one JSON line to records/log.jsonl (git HEAD, depth,
// every probe's metrics and anomalies) and rewrites records/latest.json.
// records/ is gitignored — it is this machine's lab notebook, not the repo's
// claim. The story-side companion is the route recorder
// (__pachinkode.routes()): the canary catches the number, the route tells you
// what the ball actually did.

import { readdirSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const RECORDS = path.join(HERE, 'records')

const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null }

const depth = flag('quick') ? 'quick' : 'nightly'

/** Run a node script (or node itself with flags) from the repo root, captured. */
function exec (args, { timeout = 20 * 60e3 } = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), timedOut: r.error?.code === 'ETIMEDOUT' }
}

function gitHead () {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return (r.stdout || '').trim() || 'unknown'
}

async function loadProbes () {
  const dir = path.join(HERE, 'probes')
  const files = readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()
  const probes = []
  for (const f of files) probes.push((await import(pathToFileURL(path.join(dir, f)).href)).default)
  return probes
}

const probes = await loadProbes()

if (flag('list')) {
  for (const p of probes) console.log(`  ${p.name.padEnd(12)} ${p.why}`)
  process.exit(0)
}

const only = opt('probe')
const chosen = only ? probes.filter(p => p.name === only) : probes
if (only && chosen.length === 0) {
  console.log(`  no probe named '${only}' — try --list`)
  process.exit(0)
}

const head = gitHead()
const startedAt = new Date().toISOString()
console.log(`\n  THE CANARY · ${startedAt} · HEAD ${head} · depth ${depth}\n`)

const results = []
for (const p of chosen) {
  const t0 = Date.now()
  let r
  try {
    r = await p.run({ depth, root: ROOT, exec })
  } catch (e) {
    // A crashed probe is an anomaly, not a crash of the canary — law 1.
    r = { summary: 'PROBE CRASHED', metrics: {}, anomalies: [`probe crashed: ${e.message}`] }
  }
  r.anomalies = r.anomalies || []
  const ms = Date.now() - t0
  results.push({ name: p.name, ms, summary: r.summary, metrics: r.metrics || {}, anomalies: r.anomalies })
  const mark = r.anomalies.length ? '⚠' : '·'
  console.log(`  ${mark} ${p.name.padEnd(12)} ${r.summary}   (${(ms / 1000).toFixed(1)}s)`)
  for (const a of r.anomalies) console.log(`      ⚠ ${a}`)
}

const anomalies = results.reduce((n, r) => n + r.anomalies.length, 0)
const record = { when: startedAt, head, depth, node: process.version, anomalies, probes: results }

mkdirSync(RECORDS, { recursive: true })
appendFileSync(path.join(RECORDS, 'log.jsonl'), JSON.stringify(record) + '\n')
writeFileSync(path.join(RECORDS, 'latest.json'), JSON.stringify(record, null, 2) + '\n')

console.log(`\n  ${anomalies === 0 ? 'quiet night — nothing to annotate' : anomalies + ' annotation(s) — read them, then read the invariants line first'}`)
console.log('  the canary annotates; it never gates. exit 0.\n')
process.exit(0)
