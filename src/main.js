// Boot, app state machine, and the frame loop.
//
// The wiring rule that matters: the simulation runs first and alone, then the
// dopamine model observes it, then the renderer and synth observe the dopamine
// model. Information flows one way. Nothing downstream of the simulation is
// permitted to reach back into it — that is what makes the varnish switch an
// honest control rather than a difficulty setting.

import { Machine, SPECS, FIRE_RATES, LAUNCH_INTERVAL, TULIP_PAY } from './sim/machine.js'
import { BOARD, thresholdCrestSpeed, routeOdds, foulOdds } from './sim/board.js'
import { Dopamine } from './sim/dopamine.js'
import { Renderer } from './render/board-render.js'
import { Synth } from './audio/synth.js'
import { Hud } from './ui/hud.js'

const $ = (s) => document.querySelector(s)
const SAVE_KEY = 'pachinkode.v1'

const state = {
  screen: 'title',
  spec: 'amadeji',
  rate: 'arcade',
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
  // A screen is session state, not a setting. Persisting it once let a
  // mid-play refresh restore screen:'play' behind a title-screen DOM with a
  // null machine — Space or T then threw on nothing (review find).
  state.screen = 'title'
}
function save () {
  // Whitelist, for the same reason: settings persist, session state does not.
  const { spec, rate, varnish, vol, muted, tokens, lifetime } = state
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ spec, rate, varnish, vol, muted, tokens, lifetime }))
  } catch { /* private mode */ }
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
let lastDetent = -1
let sliderHinted = false

function newSession () {
  machine = new Machine({
    seed: (Math.random() * 1e9) | 0,
    spec: state.spec,
    tokens: state.tokens,
    fireInterval: (FIRE_RATES[state.rate] || FIRE_RATES.arcade).interval
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
    // The slider earns one hint per session — it is otherwise invisible as a
    // control (a scale with a thumb reads as a readout).
    if (!sliderHinted) {
      sliderHinted = true
      banner('HOLD TO PULL · RELEASE TO FIRE', 'drag the scale below the board to set your BASE')
    }
  } else if (machine) {
    machine.firing = false
    machine.cancelCharge()
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
    `${S.note}  Jackpot 1 in ${S.jackpotOdds}; small win 小当たり 1 in ${S.koatariOdds}; during ` +
    `kakuhen 1 in ${S.kakuhenOdds} for ${S.stSpins} spins. Up to ` +
    `${S.rounds * S.entriesPerRound * S.payPerEntry} balls per jackpot — the legal ceiling is ` +
    `1500. Changing class starts a new machine.`
}
syncSpec()

// Fire rate. Changing it does not need a new machine — it is tempo, not odds —
// so it takes effect live, mid-session.
const rateSegs = $('#rateSegs')
for (const [key, R] of Object.entries(FIRE_RATES)) {
  const b = document.createElement('button')
  b.textContent = R.label
  b.dataset.rate = key
  b.addEventListener('click', () => {
    state.rate = key
    if (machine) machine.fireInterval = R.interval
    syncRate()
    save()
  })
  rateSegs.appendChild(b)
}
function syncRate () {
  for (const b of rateSegs.children) b.setAttribute('aria-pressed', String(b.dataset.rate === state.rate))
}
syncRate()

$('#resetSave').addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY)
  state.tokens = 500
  state.lifetime = { spent: 0, won: 0, jackpots: 0, balls: 0 }
  newSession()
  banner('FORGOTTEN', 'the machine has no memory of you')
})

// ── input ──────────────────────────────────────────────────────────────────
//
// Pull back, let go. Press and hold anywhere on the board (or Space) and the
// hammer draws further back; release and it fires at whatever the pull reached.
// A quick tap fires at the BASE setting — the slider on the launcher strip —
// which is what makes rapid fire aimable: mash the trigger and every ball
// leaves at roughly the base power. Two touch surfaces, no chords: the board
// is the trigger, the cabinet strip is the slider.

function setDial (v) {
  if (!machine) return
  machine.dial = Math.max(0, Math.min(1, v))
}

// Per-pointer roles. One finger owns the pull, one may own the slider, and
// every EXTRA finger on the board is a drum hit — its own base-power shot.
// A shared boolean here made two-thumb drumming fire every OTHER tap (the
// second press was swallowed by the charge guard) and let a charging finger's
// wiggles yank the slider. Roles are pointerIds now, and each end event is
// routed to the role that pointer actually held.
let sliderPointer = null
let chargePointer = null

// The slider is THE SCALE, not the whole cabinet strip: a tap on the scatter
// box or the readiness lamp must not slam BASE to 1 or 0. (±24 px of touch
// pad; everything else on the strip stays a trigger, so a fat-finger tap at
// the board's bottom edge still fires.)
function onRail (x, y) {
  const rail = renderer.dialRail
  return rail && renderer.inCabinet(y) && x > rail.x0 - 24 && x < rail.x1 + 24
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())

canvas.addEventListener('pointerdown', (e) => {
  if (!machine || e.button !== 0) return
  synth.start()
  canvas.setPointerCapture(e.pointerId)
  const r = canvas.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  if (sliderPointer === null && onRail(x, y)) {
    sliderPointer = e.pointerId
    const v = renderer.dialFromX(x)
    if (v !== null) setDial(v)
  } else if (chargePointer === null) {
    chargePointer = e.pointerId
    machine.beginCharge()
  } else {
    machine.tap()
  }
})
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === sliderPointer) {
    const r = canvas.getBoundingClientRect()
    const v = renderer.dialFromX(e.clientX - r.left)
    if (v !== null) setDial(v)
  } else if (sliderPointer === null && chargePointer === null) {
    // Hover affordance: the scale advertises that it drags.
    const r = canvas.getBoundingClientRect()
    canvas.style.cursor = onRail(e.clientX - r.left, e.clientY - r.top) ? 'ew-resize' : 'pointer'
  }
})
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerId === sliderPointer) { sliderPointer = null; return }
  if (e.pointerId === chargePointer) {
    chargePointer = null
    if (machine) machine.releaseCharge()
  }
})
canvas.addEventListener('pointercancel', (e) => {
  // An ABORTED gesture — edge swipe, notification shade, palm rejection —
  // abandons the pull. It never fires: cancel is not a release.
  if (e.pointerId === sliderPointer) { sliderPointer = null; return }
  if (e.pointerId === chargePointer) {
    chargePointer = null
    if (machine) machine.cancelCharge()
  }
})
// Losing the window mid-pull would wedge `charging` forever (the keyup or
// pointerup is never delivered) and turn the player's next tap into a
// surprise full-power shot. Abandon instead.
addEventListener('blur', () => {
  chargePointer = null; sliderPointer = null
  if (machine) machine.cancelCharge()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    chargePointer = null; sliderPointer = null
    if (machine) machine.cancelCharge()
  }
})

addEventListener('keydown', (e) => {
  if (state.screen !== 'play') {
    if (e.key === 'Escape') go('title')
    return
  }
  if (e.key === 'Escape') { go('title'); return }
  if (e.code === 'Space') {
    e.preventDefault()
    // Key auto-repeat re-fires keydown for as long as the bar is held; without
    // this guard every repeat would restart the pull at zero. And Space never
    // steals a pull a finger already owns.
    if (!e.repeat && chargePointer === null) { synth.start(); machine.beginCharge() }
    return
  }
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
addEventListener('keyup', (e) => {
  if (e.code === 'Space' && machine && state.screen === 'play' && chargePointer === null) {
    machine.releaseCharge()
  }
})

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

  // The pull, made audible: a ratchet click each time the draw crosses a
  // detent. Mechanism sound, not a reward cue — the pitch follows the spring's
  // compression because a stiffer spring rings higher, and for no other reason.
  if (machine.charging) {
    const det = Math.floor(machine.power * 24)
    if (det !== lastDetent) { synth.ratchet(machine.power, state.varnish); lastDetent = det }
  } else {
    lastDetent = -1
  }

  // The dopamine model observes; it never acts.
  for (const b of machine.world.balls) dop.visit(b)
  handleEvents(machine.drain())
  dop.update(dt, { balls: machine.world.balls.length, impacts: impactsThisFrame / dt, t })

  // Uncertainty for the bed: the live uncertainty of the ball closest to a decision.
  let U = 0
  for (const b of machine.world.balls) U = Math.max(U, dop.uncertaintyAt(b.x, b.y))
  synth.updateBed(U, dop.arousal, state.varnish)
  // The rain follows the MEASURED strike rate — counted this frame, not modelled.
  synth.updateRain(impactsThisFrame / dt, state.varnish)
  synth.updateJam(machine.foulHeat, state.varnish)

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
  // Impacts are budgeted at 7 voices a frame; spend them on the LOUDEST
  // strikes, not the first-emitted. (world.js emits in ball-iteration order —
  // a screaming nail hit used to lose its voice to whichever graze came
  // first. Review finding, measured: mean loudest-dropped 0.6–0.95 m/s vs
  // mean kept 0.4.)
  const hits = []
  for (const ev of events) {
    switch (ev.type) {
      case 'hit':
        impactsThisFrame++
        hits.push(ev)
        break

      case 'launch':
        // The hammer. Pitched by the power of the shot that actually left, and
        // duller and looser the harder the mechanism is being worked, so a
        // machine-gunned session audibly loses its crispness.
        synth.launch(ev.power, ev.worked, state.varnish)
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
        renderer.pop(ev.x, ev.y, '+3', 1.1)
        renderer.lampBurst()
        renderer.kick(0.25)
        synth.heso(state.varnish)
        // The three balls, heard landing in the tray — the reward in the
        // room's own currency, not just a jingle about it.
        synth.cascade(9, state.varnish)
        break
      }

      case 'tulip':
        dop.settle(ev.ball, TULIP_PAY)
        dop.push(TULIP_PAY)
        renderer.flash(ev.x, ev.y, 0.4)
        renderer.pop(ev.x, ev.y, '+2', 0.8)
        renderer.lampBurst(0.4)
        synth.tulip(state.varnish)
        synth.cascade(6, state.varnish)
        break

      case 'attacker':
        dop.settle(ev.ball, machine.S.payPerEntry)
        dop.push(machine.S.payPerEntry)
        renderer.flash(ev.x, ev.y, 1.0)
        renderer.pop(ev.x, ev.y, `+${ev.n}`, 1.3)
        renderer.lampBurst(0.65)
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
        // The dead thud of a ball falling back onto balls. Foul = thud,
        // play = ring — the jam becomes audible one clack at a time.
        synth.foul(state.varnish)
        break

      case 'koatari':
        // The small win: a short chord, a modest burst, and an ACTION PROMPT —
        // the attacker is on the right-hand route and the window is seven
        // seconds. This is migi-uchi, taught on a prize small enough to lose.
        renderer.lampBurst(0.7)
        renderer.kick(0.12)
        synth.koatari(state.varnish)
        synth.gate(true, state.varnish)
        banner('小当たり  SMALL WIN', 'the attacker is open, briefly — hit RIGHT')
        break

      case 'koatariEnd':
        synth.gate(false, state.varnish)
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
        // The opening sequence. What it builds toward is the HARVEST, which is
        // genuinely undecided — the ceiling is printed and the mouth has not
        // opened yet. The player's job during these seconds is to get right.
        dop.endRamp()
        dop.push(machine.S.rounds * machine.S.entriesPerRound * machine.S.payPerEntry * 0.35)
        renderer.kick(0.45)
        const size = Math.min(1, (ev.potential || 900) / 1500)
        synth.shepardStop()
        synth.jackpotBuild(ev.build, size, state.varnish)
        banner('大当たり  ŌATARI', `up to ${ev.potential} balls — get right before the mouth opens`)
        state.lifetime.jackpots++
        break
      }

      case 'jackpotOpen': {
        // The drop. The mouth, the stack, and the descent that never arrives.
        const size = Math.min(1, machine.S.rounds * machine.S.entriesPerRound *
          machine.S.payPerEntry / 1500)
        renderer.kick(1)
        renderer.lampBurst(1)
        synth.gate(true, state.varnish)
        synth.jackpot(size, state.varnish)
        // The descent runs underneath the whole jackpot and never arrives —
        // which is the honest shape of a kakuhen chain. It stops when the chain does.
        synth.shepard(200, state.varnish, (machine.chainDepth || 1) - 1)
        banner('開放  OPEN', 'the attacker is on the right-hand route')
        break
      }

      case 'kakuhen': {
        // The chain lives: the attacker slams shut, a chord states it — with a
        // duration set by the REAL continuation probability — and the descent
        // restarts THINNED, so the fall audibly continues while the machine
        // waits for the next hit. (An older comment here promised the thinned
        // descent while the code stopped it dead; kakuhen and a dead chain
        // were audibly identical. Review finding.)
        synth.shepardStop()
        synth.gate(false, state.varnish)
        const S = machine.S
        const catchP = 1 - Math.pow(1 - 1 / S.kakuhenOdds, S.stSpins)
        synth.kakuhen(catchP, state.varnish)
        synth.shepard(200, state.varnish, (machine.chainDepth || 1) - 1, 0.35)
        banner('確変  KAKUHEN', `${ev.spins} spins at 1 in ${ev.odds}`)
        break
      }

      case 'jackpotEnd':
        // The party ends with the gate's slam, not an unexplained fade.
        synth.shepardStop()
        synth.gate(false, state.varnish)
        break

      case 'kakuhenEnd':
        // The chain died quietly: the ST spins ran out. The fall stops,
        // because the thing it was falling for is gone.
        synth.shepardStop()
        break

      case 'round':
        renderer.kick(0.3)
        // The attacker re-opening is loudly mechanical on a real machine.
        synth.gate(true, state.varnish)
        break

      case 'empty':
        banner('OUT OF TOKENS', 'press T for five hundred more — it will be noted')
        break

      case 'pay':
        // Every ball gained, and nothing else. Hooked at the LEDGER rather
        // than at each pocket, so the cue cannot fire unless `won` actually
        // moved — and so any payout source added later inherits it for free.
        // Refunds do not pass through pay(), and must not: a fouled ball
        // returning is a spend reversed, not a gain.
        renderer.rewardPulse(ev.n)
        break

      case 'holdOverflow':
        // A ball that paid but bought no ticket. Small, legal, and worth seeing.
        renderer.flash(0.220, 0.332, -0.3)
        break
    }
  }

  if (hits.length) {
    hits.sort((a, b) => b.speed - a.speed)
    const top = Math.min(7, hits.length)
    for (let i = 0; i < top; i++) synth.impact(hits[i].speed, hits[i].surface, state.varnish)
  }
}

/** Expected token value of one start-pocket entry, paid + ticket. */
function hesoValue () {
  const S = machine.S
  const catchP = 1 - Math.pow(1 - 1 / S.kakuhenOdds, S.stSpins)
  const chain = 1 / (1 - S.kakuhenChance * catchP)
  const perJackpot = S.rounds * S.entriesPerRound * S.payPerEntry * 0.62  // measured harvest
  // The small win's term: ~2.5 entries harvested by a player who takes the
  // seven-second migi window (model input for the value map, tuned against
  // tools/calibrate.js runs; a player who ignores the prompt gets ~0).
  const perKoatari = S.payPerEntry * 2.5
  return 3 + (chain * perJackpot) / (machine.kakuhen > 0 ? S.kakuhenOdds : S.jackpotOdds) +
    perKoatari / S.koatariOdds
}

function updateTopbar () {
  // BASE is the slider; PULL appears while the hammer is drawn past it. The
  // route odds always describe the SHOT BEING BUILT, so holding the trigger
  // sweeps them rightward live.
  $('#tDial').textContent = machine.dial.toFixed(2)
  const pulled = machine.power - machine.dial > 0.005
  $('#tPull').textContent = pulled ? Math.round(machine.power * 100) + '%' : '—'
  $('#tPull').style.color = pulled ? 'var(--hot)' : 'var(--faint)'
  // FOUL is a MEASURED probability now (FOUL_ODDS, solo cadence), not a
  // closed-form crest inversion — the old formula said FOUL below power
  // ≈ 0.135 while ~99% of solo shots at 0.06 enter play. Same failure class
  // as the old 50:50 tick; found by the same kind of audit.
  const el = $('#tRoute')
  const pFoul = foulOdds(machine.power)
  const pRight = routeOdds(machine.power)
  const near = Math.abs(pRight - 0.5) < 0.12
  if (pFoul >= 0.5) {
    el.textContent = `FOUL ${Math.round(pFoul * 100)}%`
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
  pull () { machine && machine.beginCharge() },
  release () { machine && machine.releaseCharge() },
  go
}

requestAnimationFrame(frame)
addEventListener('load', resize)
resize()
