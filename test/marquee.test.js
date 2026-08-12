// THE MARQUEE — where the forty-eight lamps may and may not be, and the one
// thing the scene director must never do to them.
//
// All three properties here were shipped broken and were found by measurement
// rather than by reading: see docs/REVIEW-THE-PRODUCTION-LOOP-2026-08-12.md.
// Each test asserts against the REAL geometry it depends on — BOARD.rail, the
// shipped MOTIFS — rather than against a copy of the numbers, so moving the
// rail or authoring a new picture board re-checks the lamps for free.
import test from 'node:test'
import assert from 'node:assert/strict'
import { marqueeLamps } from '../src/render/board-render.js'
import { PresentationDirector, PRESENTATION_SCENES } from '../src/render/presentation.js'
import { BOARD } from '../src/sim/board-consts.js'
import { MOTIFS } from '../src/sim/motifs.js'

test('no marquee lamp is inside the rail, and none is in the launch channel', () => {
  const R = BOARD.rail
  const lamps = marqueeLamps()
  assert.equal(lamps.length, 48, 'the marquee is forty-eight lamps')
  const inside = lamps.filter(p => Math.hypot(p.x - R.cx, p.y - R.cy) < R.r)
  assert.deepEqual(inside, [],
    `${inside.length} lamps are inside the outer rail — a ball climbing the ` +
    'channel would be painted over by the cabinet\'s own furniture')
  // And they must still be ON the board, or the fix has thrown them off-plate.
  for (const p of lamps) {
    assert.ok(p.x >= 0 && p.x <= BOARD.w, `lamp off the plate at x=${p.x}`)
    assert.ok(p.y >= 0 && p.y <= BOARD.h, `lamp off the plate at y=${p.y}`)
  }
})

test('no marquee lamp lands on a motif board\'s lottery readout', () => {
  for (const [id, motif] of Object.entries(MOTIFS)) {
    const D = motif.displayRect
    if (!D) continue
    const covered = marqueeLamps(D).filter(p =>
      p.x >= D.x0 && p.x <= D.x1 && p.y >= D.y0 && p.y <= D.y1)
    assert.deepEqual(covered, [],
      `${covered.length} lamps sit on ${id}'s readout — they light during a ` +
      'REACH, which is exactly when the digits have to be readable')
    // The filter must not be over-eager either: a board still needs a marquee.
    assert.ok(marqueeLamps(D).length >= 40, `${id} lost too many lamps`)
  }
})

test('handing the lights to a new scene never blacks the field out first', () => {
  // `intensity` is the sole gate on all 48 lamps and the full-field rays, so a
  // scene that restarts from age 0 takes the whole board dark and brings it
  // back inside 140 ms. Pocket chatter is same-priority and so is not refused;
  // measured on the stock board at ARCADE this fired 0.41 times a second, four
  // times inside the busiest second — a full-field flicker above three per
  // second, which REDUCED EFFECTS does not remove (it dims and freezes travel,
  // but intensity still comes from the attack).
  const p = new PresentationDirector()
  p.trigger('pocket')
  p.update(0.3)                                  // fully attacked
  const before = p.snapshot().intensity
  assert.ok(before > 0.9, 'the scene never reached full brightness')

  p.trigger('pocket')                            // same kind, same priority
  const after = p.snapshot().intensity
  assert.ok(after >= before * 0.95,
    `re-triggering collapsed the marquee: ${before.toFixed(3)} -> ${after.toFixed(3)}`)

  // Walk the whole hand-over and assert it is monotone-ish frame by frame: no
  // single frame may drop the field by more than a quarter of full brightness.
  let last = p.snapshot().intensity
  for (let i = 0; i < 12; i++) {
    p.update(1 / 60)
    const now = p.snapshot().intensity
    assert.ok(last - now <= 0.25,
      `frame ${i} cut the field ${last.toFixed(3)} -> ${now.toFixed(3)}`)
    last = now
  }

  // A stronger scene taking over must not dip either.
  const q = new PresentationDirector()
  q.trigger('pocket'); q.update(0.3)
  const lit = q.snapshot().intensity
  q.trigger('quota')                             // higher priority, legal stomp
  assert.ok(q.snapshot().intensity >= lit * 0.95,
    'a higher-priority scene stole the lights by turning them off first')
  assert.equal(q.snapshot().kind, 'quota')

  // But a scene starting from darkness must still attack normally — the floor
  // is a hand-over device, not a permanent brightness.
  const r = new PresentationDirector()
  r.trigger('pocket')
  assert.ok(r.snapshot().intensity < 0.2, 'a cold start skipped its attack')
  r.update(PRESENTATION_SCENES.pocket.duration)
  assert.equal(r.snapshot().kind, 'idle')
})
