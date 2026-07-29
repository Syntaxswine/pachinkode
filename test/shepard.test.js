import test from 'node:test'
import assert from 'node:assert/strict'
import { shepardFrame, SHEPARD, Synth, CUE_FAMILY } from '../src/audio/synth.js'

/**
 * The keystone's socket must not rot.
 *
 * `CUE_FAMILY` is a falsifiable claim about what every sound in this game is
 * teaching, and `Synth.mark()` is what will one day let an instrument check it
 * (docs/HANDOFF.md — the conditioning ledger). A voice added later without a
 * declared family would sound in the game and be invisible to that instrument,
 * which is the quiet way a measurement stops measuring everything.
 */
test('every voice the synth can produce declares a cue family', () => {
  const s = new Synth()
  // Drive every voice headlessly. Without a WebAudio context they schedule
  // nothing, but they still stamp — which is exactly what the socket is for.
  s.heso(1); s.tulip(1); s.koatari(1); s.kakuhen(0.65, 1); s.jackpot(0.5, 1)
  s.cascade(9, 1); s.jackpotBuild(2.6, 0.5, 1); s.launch(0.5, 0, 1); s.ratchet(0.5, 1)
  s.foul(1); s.gate(true, 1); s.spinTick(1); s.lose(false, 0); s.reach(1)
  s.shepard(8, 1); s.quota(1); s.descend(1); s.split(1); s.click(); s.select()

  // 'milestone' joined the taxonomy with the quota fanfare: a voice about the
  // RUN's printed scoreboard rather than the machine's ledger, added because
  // both 'reward' (falsified by a warp crossing the quota — score, no pay)
  // and 'mechanism' (falsified by the real pay correlation) would have been
  // lies. See CUE_FAMILY for the argument and for its own checkable law.
  const FAMILIES = ['reward', 'mechanism', 'predictive', 'milestone']
  assert.ok(s.cues.length > 12, `only ${s.cues.length} voices stamped a cue`)
  for (const c of s.cues) {
    assert.notEqual(c.family, 'unknown', `voice "${c.name}" has no declared cue family`)
    assert.ok(FAMILIES.includes(c.family),
      `voice "${c.name}" claims an unrecognised family "${c.family}"`)
  }
  // And the declaration itself must stay a partition, not a wish list.
  for (const [name, fam] of Object.entries(CUE_FAMILY)) {
    assert.ok(FAMILIES.includes(fam),
      `CUE_FAMILY declares "${name}" as "${fam}", which is not a family`)
  }
})

test('a cue that did not sound is not recorded', () => {
  // The instrument's core assumption: the log is what was HEARD. A losing spin
  // is silent at full varnish, and silence cannot condition anything.
  const s = new Synth()
  s.lose(false, 1)
  assert.equal(s.cues.length, 0, 'a silent loss stamped a cue')
  s.lose(false, 0)
  assert.equal(s.cues.length, 1, 'the unvarnished loss tone failed to stamp')
})

/**
 * The jackpot glissando must remain an illusion.
 *
 * A Shepard–Risset tone works only if two things are true at once: every partial
 * is genuinely descending, and the ensemble's spectral centre of mass is not.
 * Break either and it stops being an illusion and becomes a sound effect — the
 * partials drift out of octave alignment, or the whole thing audibly sinks and
 * arrives somewhere.
 *
 * These properties were first measured by rendering the real WebAudio graph
 * offline in a browser: partials at 55/110/220/440/880 Hz, each falling at 0.938
 * octaves per second, against a centroid slope of +0.009 octaves per second.
 * The geometry is factored out into shepardFrame() so that measurement is a test
 * rather than a memory.
 */

const CYCLE = 6.4
const centroid = (frame) => {
  let a = 0, b = 0
  for (const p of frame) { a += Math.log2(p.f) * p.g; b += p.g }
  return b > 1e-9 ? a / b : 0
}

test('every partial is exactly one octave from its neighbour', () => {
  for (const t of [0, 0.7, 1.9, 3.3, 5.0, 6.39, 11.2]) {
    const fs = shepardFrame(t, CYCLE).map(p => p.f).sort((x, y) => x - y)
    for (let i = 1; i < fs.length; i++) {
      const octaves = Math.log2(fs[i] / fs[i - 1])
      assert.ok(Math.abs(octaves - 1) < 1e-9,
        `t=${t}: partials ${fs[i - 1].toFixed(1)}→${fs[i].toFixed(1)} are ${octaves.toFixed(4)} octaves apart`)
    }
  }
})

test('every partial really is descending', () => {
  // Track one voice across a step that does not wrap it.
  const rate = SHEPARD.span / CYCLE
  const a = shepardFrame(1.0, CYCLE)[0]
  const b = shepardFrame(1.5, CYCLE)[0]
  const fell = Math.log2(a.f / b.f) / 0.5
  assert.ok(b.f < a.f, 'partial did not descend')
  assert.ok(Math.abs(fell - rate) < 1e-9,
    `descent rate ${fell.toFixed(3)} oct/s, expected ${rate.toFixed(3)}`)
})

test('the spectral centroid does not descend with them', () => {
  const xs = [], ys = []
  for (let t = 2; t <= 12; t += 0.05) { xs.push(t); ys.push(centroid(shepardFrame(t, CYCLE))) }
  const n = xs.length
  const mx = xs.reduce((p, c) => p + c) / n
  const my = ys.reduce((p, c) => p + c) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  const slope = num / den
  const partialRate = SHEPARD.span / CYCLE

  // The partials fall at ~0.94 octaves/second. The centroid must be at least two
  // orders of magnitude flatter, or the listener hears the fall arrive.
  assert.ok(Math.abs(slope) < partialRate / 100,
    `centroid drifts at ${slope.toFixed(4)} oct/s against a partial rate of ${partialRate.toFixed(3)}`)

  // And it must stay in a bounded band rather than wandering.
  const range = Math.max(...ys) - Math.min(...ys)
  assert.ok(range < 0.8, `centroid wanders over ${range.toFixed(3)} octaves`)
})

test('the envelope closes at both ends, so the wrap is silent', () => {
  // A partial's gain must be zero exactly where it jumps from the bottom of the
  // span back to the top. If it is not, the loop clicks and the illusion dies.
  const atWrap = shepardFrame(0, CYCLE)[0]
  assert.ok(atWrap.g < 1e-12, `gain at the wrap point is ${atWrap.g}`)
  const mid = shepardFrame(CYCLE / 2, CYCLE)[0]
  assert.ok(mid.g > 0.99, `gain at mid-sweep is ${mid.g}, expected full`)
})

test('total power stays roughly constant, so it does not pulse', () => {
  let lo = Infinity, hi = 0
  for (let t = 0; t < CYCLE * 2; t += 0.01) {
    const p = shepardFrame(t, CYCLE).reduce((s, x) => s + x.g, 0)
    lo = Math.min(lo, p); hi = Math.max(hi, p)
  }
  assert.ok(hi - lo < 1e-9, `ensemble power swings between ${lo.toFixed(4)} and ${hi.toFixed(4)}`)
})
