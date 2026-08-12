#!/usr/bin/env node
// Measure what the sound vocabulary predicts on the real deterministic machine.
// Exit 1 only for a hard taxonomy lie: a reward-family cue without real pay.

import { Machine } from '../src/sim/machine.js'
import { DT } from '../src/sim/world.js'
import { Synth, CUE_FAMILY } from '../src/audio/synth.js'
import { ConditioningLedger, formatConditioningSummary } from '../src/audio/conditioning.js'

const argv = process.argv.slice(2)
const num = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? Number(argv[i + 1]) : fallback
}
const balls = Math.max(100, num('balls', 1200))
const seed = num('seed', 20260812)
const ledger = new ConditioningLedger()
const synth = new Synth()
synth.setVirtualAudio(true)
synth.setCueObserver(c => ledger.cue(c))

const m = new Machine({ seed, tokens: balls + 5000, fireInterval: 0.2 })
m.dial = 0.20
m.firing = true
let guard = 0

function route (ev) {
  switch (ev.type) {
    case 'pay': ledger.pay({ t: m.time, n: ev.n, source: ev.source }); if (ev.source === 'hazure') synth.cascade(ev.n, 1); break
    case 'launch': synth.launch(ev.power, ev.worked, 1); break
    case 'heso': synth.heso(1); synth.cascade(9, 1); break
    case 'bucket': synth.cascade(4, 1); break
    case 'tulip': synth.tulip(1); synth.cascade(6, 1); break
    case 'attacker': synth.cascade(ev.n, 1); break
    case 'warp': synth.warp(1); break
    case 'foul': synth.foul(1); break
    case 'koatari': synth.koatari(1); synth.gate(true, 1); break
    case 'koatariEnd': synth.gate(false, 1); break
    case 'spinStart': break
    case 'reachReveal': synth.reach(1); break
    case 'spinLose': if (!ev.paid) synth.lose(ev.reach, 1); break
    case 'jackpot': synth.jackpotBuild(ev.build, Math.min(1, (ev.potential || 900) / 1500), 1); break
    case 'jackpotOpen': synth.gate(true, 1); synth.jackpot(0.7, 1); synth.shepard(200, 1); break
    case 'kakuhen': synth.gate(false, 1); synth.kakuhen(0.65, 1); synth.shepard(200, 1, 0, 0.35); break
    case 'jackpotEnd': synth.gate(false, 1); break
    case 'round': synth.gate(true, 1); break
    case 'split': synth.split(1); break
    case 'temper': synth.temper(ev.tier, 1); break
  }
}

while (guard++ < 5e6) {
  if (m.launched >= balls) m.firing = false
  m.dial = m.inJackpot || m.koatari ? 0.88 : 0.20
  m.step(DT)
  synth.setClock(m.time)
  synth.frame()
  const events = m.drain()
  const hits = events.filter(e => e.type === 'hit').sort((a, b) => b.speed - a.speed).slice(0, 7)
  for (const ev of events) route(ev)
  // Headless WebAudio suppresses impact voices, so stamp exactly the same
  // loudest-seven budget the live shell admits.
  for (const _ of hits) ledger.cue({ t: m.time, name: 'impact', family: CUE_FAMILY.impact })

  const settled = !m.firing && m.world.balls.length === 0 && !m.spin && !m.inJackpot && !m.koatari && m.holds === 0
  if (settled) break
}
const report = ledger.summary(m.time)
const words = formatConditioningSummary(report)

console.log('\n  CUE CONTINGENCY — real machine events, horizon-matched baselines\n')
console.log(`  ${balls} launches · ${m.time.toFixed(1)} s · ${report.totalPays} payouts · 400 ms base ${(report.mechanism.baseP * 100).toFixed(1)}% · 5 s base ${(report.predictive.baseP * 100).toFixed(1)}%`)
console.log(`  ${words.reward}`)
console.log(`  ${words.predictive}`)
console.log(`  ${words.mechanism}\n`)
console.log('  voice              family         heard    backed      P(pay)       Δp')
for (const r of report.byName) {
  const name = r.name.padEnd(18)
  const family = r.family.padEnd(13)
  console.log(`  ${name} ${family} ${String(r.count).padStart(7)} ${String(r.hits).padStart(9)} ` +
    `${(r.rate * 100).toFixed(1).padStart(9)}% ${(r.delta * 100).toFixed(1).padStart(8)}pp`)
}

const rewardLies = report.byName.filter(r => r.family === 'reward' && r.hits !== r.count)
if (rewardLies.length) {
  console.error(`\n  FAIL: unbacked reward cues — ${rewardLies.map(r => `${r.name} ${r.hits}/${r.count}`).join(', ')}\n`)
  process.exit(1)
}
console.log('\n  PASS: every reward-family cue was backed by a real payout. Mechanism Δp is reported, never hand-waved.\n')
