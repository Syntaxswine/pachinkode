import test from 'node:test'
import assert from 'node:assert/strict'
import { PresentationDirector, PRESENTATION_SCENES } from '../src/render/presentation.js'
import { effectsPhase, effectsProfile } from '../src/render/board-render.js'

test('presentation scenes attack, hold, and expire deterministically', () => {
  const p = new PresentationDirector()
  assert.equal(p.snapshot().intensity, 0)
  assert.equal(p.trigger('reach'), true)
  p.update(0.14)
  assert.ok(p.snapshot().intensity > 0.9)
  p.update(PRESENTATION_SCENES.reach.duration)
  assert.equal(p.snapshot().kind, 'idle')
})

test('pocket chatter cannot stomp a live jackpot scene', () => {
  const p = new PresentationDirector()
  p.trigger('jackpot')
  p.update(0.2)
  assert.equal(p.trigger('pocket'), false)
  assert.equal(p.snapshot().kind, 'jackpot')
})

test('a higher-priority verdict can pre-empt a smaller scene', () => {
  const p = new PresentationDirector()
  p.trigger('pocket')
  p.update(0.2)
  assert.equal(p.trigger('quota'), true)
  assert.equal(p.snapshot().kind, 'quota')
})

test('reduced effects suppress the reward wash and principal motion', () => {
  const full = effectsProfile(false)
  const reduced = effectsProfile(true)
  assert.equal(full.rewardWash, 1)
  assert.equal(reduced.rewardWash, 0)
  assert.equal(reduced.motion, 0)
  assert.equal(reduced.shake, 0)
  assert.ok(reduced.flash <= 0.2)
  assert.ok(reduced.lamps <= 0.25)
  assert.equal(effectsPhase(0.1, true), effectsPhase(0.9, true),
    'a reduced marquee still travelled with scene phase')
  assert.notEqual(effectsPhase(0.1, false), effectsPhase(0.9, false),
    'full-show scene phase was accidentally frozen')
})
