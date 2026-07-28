// Boot, app state machine, and the frame loop.
//
// The wiring rule that matters: the simulation runs first and alone, then the
// dopamine model observes it, then the renderer and synth observe the dopamine
// model. Information flows one way. Nothing downstream of the simulation is
// permitted to reach back into it — that is what makes the varnish switch an
// honest control rather than a difficulty setting.

import { Machine, SPECS, LAUNCH_INTERVAL, TULIP_PAY } from './sim/machine.js'
import { BOARD, thresholdCrestSpeed, routeOdds } from './sim/board.js'
import { Dopamine } from './sim/dopamine.js'
import { Renderer } from './render/board-render.js'
import { Synth } from './audio/synth.js'
import { Hud } from './ui/hud.js'

const $ = (s) => document.querySelector(s)
const SAVE_KEY = 'pachinkode.v1'

const state = {
  screen: 'title',
  spec: 'amadeji',
  varnish: 1,
  vol: { master: 0.70, impacts: 0.55, rewards: 0.80, bed: 0.35 },
  muted: false,
  tokens: 500,
  lifetime: { spent: 0, won: 0, jackpots: 0, balls: 0 }
}

function load () {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) Object.assign(state, JSON.parse(raw))
  } catch { /* a corrupt save is not worth a crash */ }
}
function save () {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)) } catch { /* private mode */ }
}
load()

// ── app objects ────────────────────────────────────────────────────────────

const canvas = $('#board')
const renderer = new Renderer(canvas)
const synth = new Synth()
const hud = new Hud($('#panel'))
let machine = null
let dop = null
let firingHeld = false
let lastT = 0
let impactsThisFrame = 0
let bannerTimer = 0

function newSession () {
  machine = new Machine({
    seed: (Math.random() * 1e9) | 0,
    spec: state.spec,
    tokens: state.tokens
  })
  dop = new Dopamine(BOARD.w, BOARD.h)
  machine.dial = 0.20
  renderer.trails.clear()
}

// ── screens ────────────────────────────────────────────────────────────────

function go (name) {
  state.screen = name
  for (const id of ['title', 'options', 'about']) $('#' + id).classList.toggle('on', id === name)
  $('#play').classList.toggle('on', name === 'play')
  if (name === 'play') {
    if (!machine) newSession()
    resize()
  } else if (machine) {
    machine.firing = false
    firingHeld = false
  }
  save()
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]')
  if (!b) return
  synth.start().then(() => synth.click())
  go(b.dataset.go)
})
$('#toTitle').addEventListener('click', () => go('title'))

// ── options ────────────────────────────────────────────────────────────────

function bindSlider (id, out, get, set) {
  const el = $('#' + id), o = $('#' + out)
  el.value = Math.round(get() * 100)
  o.textContent = el.value
  el.addEventListener('input', () => {
    o.textContent = el.value
    set(+el.value / 100)
    save()
  })
}
bindSlider('vMaster', 'oMaster', () => state.vol.master, v => { state.vol.master = v; pushVol() })
bindSlider('vImpacts', 'oImpacts', () => state.vol.impacts, v => { state.vol.impacts = v; pushVol() })
bindSlider('vRewards', 'oRewards', () => state.vol.rewards, v => { state.vol.rewards = v; pushVol() })
bindSlider('vBed', 'oBed', () => state.vol.bed, v => { state.vol.bed = v; pushVol() })
bindSlider('vVarnish', 'oVarnish', () => state.varnish, v => { state.varnish = v })

const pushVol = () => synth.setVolumes(state.vol)

const muteBtn = $('#vMute')
const syncMute = () => {
  muteBtn.setAttribute('aria-pressed', String(state.muted))
  muteBtn.textContent = state.muted ? 'MACHINE IS SILENT' : 'SILENCE THE MACHINE'
  synth.setMuted(state.muted)
}
muteBtn.addEventListener('click', () => { state.muted = !state.muted; syncMute(); save() })
syncMute()

const segs = $('#specSegs')
for (const [key, S] of Object.entries(SPECS)) {
  const b = document.createElement('button')
  b.textContent = S.label
  b.addEventListener('click', () => {
    state.spec = key
    syncSpec()
    newSession()
    save()
  })
  b.dataset.spec = key
  segs.appendChild(b)
}
function syncSpec () {
  for (const b of segs.children) b.setAttribute('aria-pressed', String(b.dataset.spec === state.spec))
  const S = SPECS[state.spec]
  $('#specNote').textContent =
    `${S.note}  Jackpot 1 in ${S.jackpotOdds}; during kakuhen 1 in ${S.kakuhenOdds} for ` +
    `${S.stSpins} spins. Up to ${S.rounds * S.entriesPerRound * S.payPerEntry} balls per jackpot ` +
    `— the legal ceiling is 1500. Changing class starts a new machine.`
}
syncSpec()

$('#resetSave').addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY)
  state.tokens = 500
  state.lifetime = { spent: 0, won: 0, jackpots: 0, balls: 0 }
  newSession()
  banner('FORGOTTEN', 'the machine has no memory of you')
})

// ── input ──────────────────────────────────────────────────────────────────
//
// One knob and a trigger, because that is the entire input surface of a real
// pachinko machine. Drag vertically to set launch strength; hold to fire.

function setDial (v) {
  if (!machine) return
  machine.dial = Math.max(0, Math.min(1, v))
}

let dragging = false
canvas.addEventListener('pointerdown', (e) => {
  synth.start()
  canvas.setPointerCapture(e.pointerId)
  dragging = true
  firingHeld = true
  dialFromPointer(e)
})
canvas.addEventListener('pointermove', (e) => { if (dragging) dialFromPointer(e) })
canvas.addEventListener('pointerup', () => { dragging = false; firingHeld = false })
canvas.addEventListener('pointercancel', () => { dragging = false; firingHeld = false })

function dialFromPointer (e) {
  const r = canvas.getBoundingClientRect()
  // Map against the PLAYFIELD, not the whole canvas — the canvas now carries the
  // launcher cabinet below the board, and including it would make the bottom
  // eighth of the dial's travel land on a strip that is not the playfield.
  const top = renderer.oy
  const height = BOARD.h * renderer.scale
  setDial(1 - ((e.clientY - r.top) - top) / height)
}

addEventListener('keydown', (e) => {
  if (state.screen !== 'play') {
    if (e.key === 'Escape') go('title')
    return
  }
  if (e.key === 'Escape') { go('title'); return }
  if (e.code === 'Space') { e.preventDefault(); synth.start(); firingHeld = true; return }
  if (e.key === 'ArrowUp') { setDial(machine.dial + (e.shiftKey ? 0.002 : 0.02)); e.preventDefault() }
  if (e.key === 'ArrowDown') { setDial(machine.dial - (e.shiftKey ? 0.002 : 0.02)); e.preventDefault() }
  if (e.key === 'v' || e.key === 'V') {
    state.varnish = state.varnish > 0.5 ? 0 : 1
    $('#vVarnish').value = state.varnish * 100
    $('#oVarnish').textContent = Math.round(state.varnish * 100)
    banner(state.varnish > 0.5 ? 'VARNISHED' : 'UNVARNISHED',
      state.varnish > 0.5 ? 'the dopamine layer is on' : 'same machine, same odds, no lacquer')
    save()
  }
  if (e.key === 't' || e.key === 'T') {
    // Top up. Deliberately frictionless — this is a simulator, not a casino —
    // but every conjured token is recorded and shown, which a parlour would never do.
    machine.addTokens(500)
    banner('+500 CONJURED', 'noted in the ledger')
  }
})
addEventListener('keyup', (e) => { if (e.code === 'Space') firingHeld = false })

function banner (text, sub = '') {
  $('#bannerText').textContent = text
  $('#bannerSub').textContent = sub
  $('#banner').classList.add('on')
  bannerTimer = 2.2
}

// ── layout ─────────────────────────────────────────────────────────────────

function resize () {
  const stage = $('#stage')
  const w = stage.clientWidth, h = stage.clientHeight
  if (!w || !h) return
  const aspect = BOARD.w / BOARD.h
  let cw = Math.min(w - 16, (h - 16) * aspect)
  let ch = cw / aspect
  renderer.resize(Math.max(180, cw), Math.max(180, ch))
}
addEventListener('resize', resize)

// ── the loop ───────────────────────────────────────────────────────────────

const THRESHOLD = thresholdCrestSpeed()

function frame (now) {
  requestAnimationFrame(frame)
  const t = now / 1000
  let dt = Math.min(0.05, t - lastT || 0.016)
  lastT = t
  if (state.screen !== 'play' || !machine) return

  synth.frame()
  impactsThisFrame = 0

  machine.firing = firingHeld && machine.tokens > 0
  machine.step(dt)

  // The dopamine model observes; it never acts.
  for (const b of machine.world.balls) dop.visit(b)
  handleEvents(machine.drain())
  dop.update(dt, { balls: machine.world.balls.length, impacts: impactsThisFrame / dt, t })

  // Uncertainty for the bed: the live uncertainty of the ball closest to a decision.
  let U = 0
  for (const b of machine.world.balls) U = Math.max(U, dop.uncertaintyAt(b.x, b.y))
  synth.updateBed(U, dop.arousal, state.varnish)

  renderer.draw(machine, dop, state.varnish, dt)
  hud.update(machine, dop, state.varnish)
  updateTopbar()

  if (bannerTimer > 0) {
    bannerTimer -= dt
    if (bannerTimer <= 0) $('#banner').classList.remove('on')
  }

  state.tokens = machine.tokens
}

function handleEvents (events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'hit':
        impactsThisFrame++
        synth.impact(ev.speed, ev.surface, state.varnish)
        break

      case 'launch':
        // The hammer. Duller and looser the harder the mechanism is being worked,
        // so a machine-gunned session audibly loses its crispness.
        synth.launch(ev.dial, ev.worked, state.varnish)
        break

      case 'heso': {
        // The value of a start-pocket entry is not the three balls it pays. It is
        // three balls plus a lottery ticket, and the ticket is worth far more.
        //
        // `ev.ball` is required, not optional. An earlier `|| {}` fallback here
        // meant every settle silently missed, the value map stayed flat zero, and
        // the trails were permanently cold — the one image this whole game is
        // built around simply did not happen, and nothing failed loudly enough to
        // say so. If the ball ever goes missing again, let it throw.
        const v = hesoValue()
        dop.settle(ev.ball, v)
        dop.push(v)
        renderer.flash(ev.x, ev.y, 1.2)
        renderer.kick(0.25)
        synth.heso(state.varnish)
        break
      }

      case 'tulip':
        dop.settle(ev.ball, TULIP_PAY)
        dop.push(TULIP_PAY)
        renderer.flash(ev.x, ev.y, 0.4)
        synth.tulip(state.varnish)
        break

      case 'attacker':
        dop.settle(ev.ball, machine.S.payPerEntry)
        dop.push(machine.S.payPerEntry)
        renderer.flash(ev.x, ev.y, 1.0)
        renderer.kick(0.18)
        synth.cascade(machine.S.payPerEntry, state.varnish)
        break

      case 'warp':
        // Same ball, new id. Carry its history so the route can be learned.
        dop.carry(ev.ball, ev.into)
        renderer.flash(ev.x, ev.y, 0.25)
        break

      case 'drain':
        if (ev.ball) dop.settle(ev.ball, 0)
        break

      case 'foul':
        if (ev.ball) dop.settle(ev.ball, 0)
        break

      case 'spinStart':
        dop.beginRamp(ev.reach ? 0.5 : 0.12)
        synth.spinTick(state.varnish)
        if (ev.reach) synth.reach(state.varnish)
        break

      case 'spinLose':
        dop.endRamp()
        // A reach that lost is the near-miss. Pleasantness down, motivation up.
        if (ev.reach) dop.nearMiss(true)
        else dop.push(-0.8)
        synth.lose(ev.reach, state.varnish)
        break

      case 'jackpot': {
        dop.endRamp()
        dop.push(machine.S.rounds * machine.S.entriesPerRound * machine.S.payPerEntry * 0.35)
        renderer.kick(1)
        const size = Math.min(1, machine.S.rounds * machine.S.entriesPerRound *
          machine.S.payPerEntry / 1500)
        synth.jackpot(size, state.varnish)
        // The descent runs underneath the whole jackpot and never arrives —
        // which is the honest shape of a kakuhen chain. It stops when the chain does.
        synth.shepardStop()
        synth.shepard(200, state.varnish, (ev.depth || 1) - 1)
        banner('大当たり  ŌATARI', 'hit the dial past the threshold — the attacker is on the right')
        state.lifetime.jackpots++
        break
      }

      case 'kakuhen':
        // The chain continues, so the fall does too — but the attacker has shut,
        // so the descent thins out to wait for the next hit.
        synth.shepardStop()
        banner('確変  KAKUHEN', `${ev.spins} spins at 1 in ${ev.odds}`)
        break

      case 'jackpotEnd':
        synth.shepardStop()
        break

      case 'round':
        renderer.kick(0.3)
        break

      case 'empty':
        banner('OUT OF TOKENS', 'press T for five hundred more — it will be noted')
        break

      case 'holdOverflow':
        // A ball that paid but bought no ticket. Small, legal, and worth seeing.
        renderer.flash(0.220, 0.332, -0.3)
        break
    }
  }
}

/** Expected token value of one start-pocket entry, paid + ticket. */
function hesoValue () {
  const S = machine.S
  const catchP = 1 - Math.pow(1 - 1 / S.kakuhenOdds, S.stSpins)
  const chain = 1 / (1 - S.kakuhenChance * catchP)
  const perJackpot = S.rounds * S.entriesPerRound * S.payPerEntry * 0.62  // measured harvest
  return 3 + (chain * perJackpot) / (machine.kakuhen > 0 ? S.kakuhenOdds : S.jackpotOdds)
}

function updateTopbar () {
  $('#tDial').textContent = machine.dial.toFixed(2)
  const v = machine.speedFor(machine.dial)
  // Crest speed from the launch speed, allowing for the sliding-to-rolling loss
  // and the climb. Above the threshold the ball takes the right-hand route.
  const rolling = v * 5 / 7
  const crest2 = rolling * rolling - (10 / 7) * 9.80665 * 0.335
  const crest = crest2 > 0 ? Math.sqrt(crest2) : 0
  const el = $('#tRoute')
  const pRight = routeOdds(machine.dial)
  const near = Math.abs(pRight - 0.5) < 0.12
  if (crest <= 0.02) {
    el.textContent = 'FOUL'
    el.style.color = 'var(--faint)'
  } else {
    el.textContent = `左 ${Math.round((1 - pRight) * 100)} : ${Math.round(pRight * 100)} 右`
    el.style.color = near ? 'var(--hot)' : 'var(--ink)'
  }

  $('#tState').textContent = machine.inJackpot
    ? '大当たり — hit right'
    : machine.kakuhen > 0 ? `確変 ${machine.kakuhen}`
      : near ? 'COIN FLIP — the least predictable dial position' : ''
  $('#tState').style.color = near ? 'var(--hot)' : 'var(--dim)'
}

/**
 * Debug handle. Read-only in spirit: it exists so the running game can be
 * inspected and driven from the console or a browser-automation harness without
 * a build step. `fire()` is the only mutator, and it does exactly what holding
 * the trigger does.
 */
globalThis.__pachinkode = {
  state,
  get machine () { return machine },
  get dop () { return dop },
  renderer,
  synth,
  threshold: THRESHOLD,
  fire (on = true) { firingHeld = on },
  go
}

requestAnimationFrame(frame)
addEventListener('load', resize)
resize()
