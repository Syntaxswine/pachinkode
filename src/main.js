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
import { Run, FLOORS, quotaFor, BALLS_BASE, SHOP, sandboxCabinet } from './sim/run.js'
import { CABINETS, CABINET_ORDER, isUnlocked, unlockText, recordRun, newMeta } from './sim/cabinets.js'
import { PART_BY_ID, countPart } from './sim/loadout.js'
import { scoreTier } from './render/palette.js'

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
  lifetime: { spent: 0, won: 0, jackpots: 0, balls: 0 },
  // The roguelike's persistent record. Everything that survives a death lives
  // here and nowhere else, so "what have I unlocked" has exactly one answer.
  meta: newMeta()
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
  // A save written before the roguelike has no meta record. Merge rather than
  // replace so a returning player keeps their tokens and their ledger.
  state.meta = Object.assign(newMeta(), state.meta || {})
}
function save () {
  // Whitelist, for the same reason: settings persist, session state does not.
  // `meta` is on the list and a RUN is not — a run in progress is session
  // state, and a roguelike that silently restores one is a roguelike whose
  // death is optional.
  const { spec, rate, varnish, vol, muted, tokens, lifetime, meta } = state
  try {
    localStorage.setItem(SAVE_KEY,
      JSON.stringify({ spec, rate, varnish, vol, muted, tokens, lifetime, meta }))
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
let run = null                 // the roguelike layer, or null in FREE PLAY
let firingHeld = false
let lastT = 0
let impactsThisFrame = 0
let bannerTimer = 0
let lastDetent = -1
let sliderHinted = false

const interval = () => (FIRE_RATES[state.rate] || FIRE_RATES.arcade).interval

/**
 * FREE PLAY: the original exhibit — no quota, no clock, tokens on request —
 * now with a scoreboard that is a WALLET (operator's ruling). The sandbox Run
 * observes exactly as a real one does; it just has no wall to hit and no
 * floor to fail. Its score buys parts and balls at the shop, reached through
 * the same bar a real run banks from.
 */
function newSession () {
  run = new Run(sandboxCabinet(state.spec), (Math.random() * 1e9) | 0)
  machine = new Machine({
    seed: (Math.random() * 1e9) | 0,
    spec: state.spec,
    tokens: state.tokens,
    fireInterval: interval(),
    loadout: run.loadout
  })
  dop = new Dopamine(BOARD.w, BOARD.h)
  machine.dial = 0.20
  renderer.trails.clear()
  renderer.ripples.length = 0
  renderer.routeLog.length = 0
  renderer.fades.length = 0
}

// ── the run ────────────────────────────────────────────────────────────────

function startRun (cabKey) {
  run = new Run(CABINETS[cabKey], (Math.random() * 1e9) | 0)
  state.cab = cabKey
  buildFloor()
  save()
}

/**
 * A fresh Machine for every floor.
 *
 * Not an optimisation choice — a correctness one. The board is a function of
 * the loadout (see board.js), and a part taken in the back room is new brass in
 * the field: nails culled differently, cups where there were none, a wider
 * funnel over the start pocket. There is no way to mutate the old board into
 * the new one that is not just building it again, badly.
 *
 * The dopamine model is rebuilt with it. That is deliberate too: its whole
 * content is a learned map of where value lives on THIS board, and carrying it
 * across a geometry change would have it confidently reporting the value of a
 * lane that no longer exists.
 */
function buildFloor () {
  machine = new Machine({
    seed: (Math.random() * 1e9) | 0,
    spec: run.cabinet.spec,
    tokens: run.ballsLeft,
    fireInterval: interval(),
    loadout: run.loadout
  })
  dop = new Dopamine(BOARD.w, BOARD.h)
  machine.dial = 0.20
  renderer.trails.clear()
  renderer.bucketFlare.clear()
  renderer.scorePops.length = 0
  renderer.ripples.length = 0
  // Routes describe a board; this is a new board.
  renderer.routeLog.length = 0
  renderer.fades.length = 0
}

// ── screens ────────────────────────────────────────────────────────────────

const SCREENS = ['title', 'options', 'about', 'cabinets', 'backroom', 'runover', 'records']

function go (name) {
  state.screen = name
  for (const id of SCREENS) $('#' + id).classList.toggle('on', id === name)
  $('#play').classList.toggle('on', name === 'play')
  if (name === 'title') { syncMeta() }
  if (name === 'cabinets') { syncCabinets() }
  if (name === 'records') { syncRecords() }
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
  if (name !== 'play') {
    // The floor bar is a function of the run's state, but its sync only runs
    // inside the play tick — leaving the screen would otherwise strand the
    // stage's reserved padding, and the next buildFloor would fit the canvas
    // into room the bar is no longer standing in.
    $('#play').classList.remove('quota')
    $('#floorbar').classList.remove('on')
    fbCache = ''
  }
  save()
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]')
  if (!b) return
  synth.start().then(() => synth.click())
  // FREE PLAY from the title tears down any REAL run in progress. Leaving one
  // half-alive behind the free-play board was how the first build ended up
  // scoring a quota nobody was playing for. An existing sandbox is kept —
  // stepping out to the title and back must not reset the exhibit.
  if (b.dataset.mode === 'free' && run && !run.sandbox) newSession()
  go(b.dataset.go)
})
$('#toTitle').addEventListener('click', () => go('title'))
$('#resumeRun').addEventListener('click', () => {
  synth.start().then(() => synth.click())
  // Resume onto whichever screen the run is actually waiting on. A run whose
  // quota is met but unbanked resumes straight to the board — the floor bar
  // reappears with it, because the bar is a function of the run's state.
  if (run.status === 'cleared') { syncBackroom(); go('backroom') } else go('play')
})

// ── the cabinet select ─────────────────────────────────────────────────────

function syncMeta () {
  // Escape leaves a run alive rather than killing it. A roguelike may not save
  // a run to disk — that is what makes a death a death — but losing one to a
  // mistyped key inside the same session is not integrity, it is a bug with a
  // principle stapled to it.
  const btn = $('#resumeRun')
  // A sandbox is not a run to resume — FREE PLAY is its own door.
  btn.style.display = run && !run.sandbox && run.status !== 'failed' ? '' : 'none'
  if (run && !run.sandbox && run.status !== 'failed') {
    $('#resumeSub').textContent =
      `${run.cabinet.label} · floor ${run.floor} · ${fmt(run.score)} banked · ` +
      `${run.ballsLeft} balls in the tray`
  }
  const m = state.meta
  // The headline record, on the title screen where a high score belongs.
  const top = (m.records || [])[0]
  $('#titleBest').innerHTML = top
    ? `<b>${fmt(top.score)}</b>${CABINETS[top.cab] ? CABINETS[top.cab].label : top.cab} · ` +
      `FLOOR ${top.floor}${top.cleared ? ' · CLEARED' : ''}`
    : (m.runs ? '<b>—</b>NO RUN SCORED YET' : '')
  $('#metaLine').textContent = m.runs
    ? `${m.runs} run${m.runs === 1 ? '' : 's'} · best floor ${m.bestFloor} · ` +
      `${fmt(m.lifetimeScore)} lifetime${m.wins ? ` · ${m.wins} cleared` : ''}`
    : ''
}

// ── records ────────────────────────────────────────────────────────────────

function syncRecords () {
  const m = state.meta
  const rows = m.records || []
  const table = $('#recTable')
  table.textContent = ''
  if (!rows.length) {
    table.innerHTML = '<div class="empty">No runs recorded yet. Every run ends somewhere; ' +
      'this is where it goes.</div>'
  } else {
    rows.forEach((r, i) => {
      const cab = CABINETS[r.cab]
      const d = document.createElement('div')
      d.className = 'r' + (i === 0 ? ' top' : '') + (r.cleared ? ' win' : '')
      // Rank always, and the star as a separate mark on the FLOOR. Using the
      // star in place of the rank read as "these three are equal" once the top
      // of the table filled up with cleared runs.
      d.innerHTML =
        `<span class="n">${i + 1}</span>` +
        `<span><span class="s">${fmt(r.score)}</span>` +
        `<span class="d">  ${cab ? cab.label : r.cab} · floor ${r.floor}` +
        `${r.cleared ? ' ★' : ''} · ${r.parts} part${r.parts === 1 ? '' : 's'} · ` +
        `chain ${r.chain}</span></span>` +
        `<span class="d">${r.at ? new Date(r.at).toLocaleDateString() : ''}</span>`
      table.appendChild(d)
    })
  }

  const cabs = $('#recCabs')
  cabs.textContent = ''
  let any = false
  for (const key of CABINET_ORDER) {
    const pc = (m.perCab || {})[key]
    if (!pc || !pc.runs) continue
    any = true
    const d = document.createElement('div')
    d.className = 'r'
    d.innerHTML =
      `<span class="n">${CABINETS[key].jp}</span>` +
      `<span><span class="s">${fmt(pc.best)}</span>` +
      `<span class="d">  ${CABINETS[key].label} · ×${CABINETS[key].difficulty.toFixed(2)} quota · ` +
      `best floor ${pc.bestFloor}</span></span>` +
      `<span class="d">${pc.runs} run${pc.runs === 1 ? '' : 's'}` +
      `${pc.cleared ? ` · ${pc.cleared} cleared` : ''}</span>`
    cabs.appendChild(d)
  }
  if (!any) cabs.innerHTML = '<div class="empty">Nothing played yet.</div>'

  const stat = (k, v) => `<div class="stat"><span>${k}</span><span>${v}</span></div>`
  $('#recStats').innerHTML =
    stat('runs', m.runs || 0) +
    stat('deepest floor', m.bestFloor || 0) +
    stat('runs cleared (12 floors)', m.wins || 0) +
    stat('longest chain', m.bestChain || 0) +
    stat('lifetime score', fmt(m.lifetimeScore || 0)) +
    stat('mean score per run', m.runs ? fmt((m.lifetimeScore || 0) / m.runs) : '—')
}

const fmt = (n) => Math.round(n).toLocaleString('en-US')

function syncCabinets () {
  const host = $('#cabList')
  host.textContent = ''
  for (const key of CABINET_ORDER) {
    const c = CABINETS[key]
    const open = isUnlocked(c, state.meta)
    const b = document.createElement('button')
    b.className = 'cab'
    b.disabled = !open
    const fitted = (c.parts || []).length
    b.innerHTML =
      `<span class="nm">${open ? c.label : '???????'}</span>` +
      `<span class="jp2">${open ? c.jp : '　'}</span>` +
      `<span class="dsc">${open ? c.note : 'Locked.'}</span>` +
      (open
        ? `<span class="fit">quota ×${c.difficulty.toFixed(2)}` +
          `${fitted ? ` · starts with ${fitted} part${fitted > 1 ? 's' : ''} already fitted` : ' · stock board'}</span>`
        : `<span class="lock">${unlockText(c, state.meta)}</span>`)
    if (open) b.addEventListener('click', () => { synth.click(); startRun(key); go('play') })
    host.appendChild(b)
  }
}

// ── the floor bar ──────────────────────────────────────────────────────────
//
// The door out of a cleared floor. The floor does not pause when the quota is
// met — the operator's ruling, and the honest one: pushing on is a thing the
// player does by continuing to fire, so the only control that needs to exist
// is the one that ends the floor. Both sides of the trade stay printed while
// it is being made: the bar's text is the push incentive (the next part's
// price, live) and the button is the bank incentive (the carry, live and
// already capped — a player banking 400 balls must never be quietly given
// 160). Numbers a player cannot weigh are not a trade.

let fbCache = ''
function syncFloorbar () {
  // Two tenants, one bar. In a run it is the door out of a met floor; in the
  // sandbox it is the shop's door, up the whole session — same slot at the
  // stage's foot, so the player learns one place to look for "spend".
  const on = !!(run && state.screen === 'play' &&
    (run.sandbox || (run.status === 'playing' && run.metQuota)))
  const play = $('#play')
  if (play.classList.contains('quota') !== on) {
    play.classList.toggle('quota', on)
    $('#floorbar').classList.toggle('on', on)
    // The stage just changed height under the canvas — refit it now, not at
    // the next window resize.
    resize()
  }
  if (!on) { fbCache = ''; return }

  const r = run
  const btn = $('#fbBank')
  if (r.sandbox) {
    const key = `sb|${r.score}|${r.partPrice}`
    if (key === fbCache) return
    fbCache = key
    $('#fbHead').textContent = `FREE PLAY · ${fmt(r.score)} SCORE`
    $('#fbSub').textContent =
      `the shop takes score — a part is ${fmt(r.partPrice)}, ${SHOP.ballBundle} balls are ${fmt(SHOP.ballPrice)}`
    btn.firstChild.textContent = 'THE SHOP ▸'
    $('#fbNote').textContent = 'trade the number for brass or balls'
    return
  }

  const carry = Math.min(Math.max(0, r.ballsLeft), BALLS_BASE)
  const picks = r.picksEarned()
  const nextAt = r.nextPickAt()
  // floorScore is in the key: the push price is quoted against it, and balls
  // still in flight keep scoring while the launcher rests.
  const key = `${r.floor}|${carry}|${picks}|${nextAt}|${r.ballsLeft}|${r.floorScore}`
  if (key === fbCache) return
  fbCache = key

  $('#fbHead').textContent =
    `${r.floor > FLOORS ? `OVERTIME ${r.floor - FLOORS}` : `FLOOR ${r.floor}`} — QUOTA MET · ` +
    `${picks} PART${picks === 1 ? '' : 'S'} EARNED`
  $('#fbSub').textContent = nextAt
    ? `push on — ${fmt(nextAt - r.floorScore)} more score buys another part`
    : r.floor === 1
      ? 'floor one pays one part, no more — the rest of the tray is yours to bank'
      : 'surplus ceiling reached — every ball from here is score alone'
  btn.firstChild.textContent = `BANK ${carry} ▸ NEXT FLOOR`
  $('#fbNote').textContent =
    `through the back room` +
    `${carry < r.ballsLeft ? ` · the carry caps at ${BALLS_BASE}` : ''}`
}

$('#fbBank').addEventListener('click', () => {
  // Guarded even though the off-state bar is visibility-hidden: defence in
  // depth costs one line, and this handler once dereferenced a null run when
  // Tab+Enter reached the invisible button (review finding). The charge is
  // cancelled only AFTER a gate agrees — a refused press must not cost the
  // player their pull.
  if (!run) return
  if (run.sandbox) {
    // The shop. Browsable any time; leaving costs nothing. The one refusal:
    // a party in progress — the fitter will not swap brass with the attacker
    // open (Machine#refit would refuse and the loadout would drift ahead of
    // the board), and shopping through a jackpot is leaving money on it.
    if (machine.inJackpot || machine.koatari) {
      banner('THE FITTER WAITS', 'no brass swaps with the attacker open — let the party finish')
      return
    }
    synth.click()
    machine.cancelCharge()
    firingHeld = false
    // The shelf KEEPS between visits — deal only when there has never been
    // one. An unconditional re-deal here made door-toggling a free unlimited
    // reroll that nullified the catalogue's draw weights (review finding: a
    // gold shelf every ~20 toggles), while the leave button promised the
    // opposite. Buying re-deals, because buying is the paid reroll.
    if (!run.offers) run.shopDeal()
    syncShop()
    go('backroom')
    return
  }
  if (run.status !== 'playing' || !run.metQuota) return
  synth.click()
  // bank() clears the floor, which emits 'draft'; drainRun's handler is what
  // navigates to the back room. Doing it here as well would be two places
  // deciding the same thing, and they would drift. No banner: the back room's
  // own sub-line states the banked count, and a banner set here lands on a
  // screen that is already hidden (review finding — it was dead UI on every
  // single bank, inherited from the old modal and kept by mistake).
  if (run.bank()) {
    machine.cancelCharge()
    firingHeld = false
    drainRun()
  }
})

// ── the back room ──────────────────────────────────────────────────────────

function syncBackroom () {
  // Two tenants share this screen (see syncShop) — restore the run's signage,
  // or a back room visited after a shop session still reads like the shop.
  const skip = $('#brSkip')
  skip.childNodes[0].textContent = 'TAKE NOTHING'
  skip.querySelector('small').textContent = 'forfeits this floor’s remaining picks'
  $('#brHead').textContent = run.floor > FLOORS
    ? `OVERTIME ${run.floor - FLOORS} CLEARED`
    : `FLOOR ${run.floor} CLEARED`
  const left = run.picksLeft
  const surplus = run.surplusPicks()
  $('#brSub').textContent =
    `${fmt(run.floorScore)} against a quota of ${fmt(run.quota)} — ` +
    `×${(run.floorScore / run.quota).toFixed(1)}. ` +
    `Take ${left} part${left > 1 ? 's' : ''}` +
    `${surplus ? ` (${left - surplus} for the floor, ${surplus} bought with surplus)` : ''} — ` +
    `the back room deals again for each one. ` +
    (run.banked ? `${run.banked} balls banked. ` : '') +
    `Next floor wants ${fmt(nextQuota())}.`
  const host = $('#brOffers')
  host.textContent = ''
  for (const p of run.offers || []) {
    const have = countPart(run.loadout, p.id)
    const b = document.createElement('button')
    b.className = 'offer'
    b.innerHTML =
      `<span class="nm">${p.name}</span><span class="jp2">${p.jp}</span>` +
      `<span class="bl">${p.blurb}</span><span class="dt">${p.detail}</span>` +
      (have ? `<span class="have">FITTED ×${have}${p.max ? ` OF ${p.max}` : ''}</span>` : '')
    b.addEventListener('click', () => {
      synth.click()
      run.take(p.id)
      afterDraft()
    })
    host.appendChild(b)
  }
}

// What the next floor will ask for, AFTER whatever relief the current loadout
// carries — so a player weighing SOFTER QUOTA can watch it work before paying
// for it. Computed with the run's own function rather than a copy of the
// constants: a second copy of the curve in the shell is a second curve.
const nextQuota = () =>
  quotaFor(run.floor + 1, run.loadout, run.cabinet.difficulty || 1)

// ── the shop (sandbox) ─────────────────────────────────────────────────────
//
// The back room's second tenant. Same screen, same offer cards, different
// contract: prices instead of picks, a wallet instead of a floor, and leaving
// is free — TAKE NOTHING forfeits picks in a run, but a shop you can only
// browse once is not a shop.

function syncShop () {
  const r = run
  $('#brHead').textContent = 'THE SHOP'
  $('#brSub').textContent =
    `${fmt(r.score)} score in hand · ${fmt(r.spent)} spent so far. ` +
    `A part is ${fmt(r.partPrice)}; each one fitted raises the next's price by the wall's own ` +
    `ratio. ${SHOP.ballBundle} balls are ${fmt(SHOP.ballPrice)}.`
  const host = $('#brOffers')
  host.textContent = ''
  for (const p of r.offers || []) {
    const have = countPart(r.loadout, p.id)
    const poor = r.score < r.partPrice
    const b = document.createElement('button')
    b.className = 'offer'
    b.disabled = poor
    if (poor) b.style.opacity = '.45'
    b.innerHTML =
      `<span class="nm">${p.name}</span><span class="jp2">${p.jp}</span>` +
      `<span class="bl">${fmt(r.partPrice)} SCORE</span>` +
      `<span class="dt">${p.blurb}</span>` +
      (have ? `<span class="have">FITTED ×${have}${p.max ? ` OF ${p.max}` : ''}</span>` : '')
    b.addEventListener('click', () => {
      synth.click()
      if (run.buy(p.id)) { drainRun(); syncShop() }
    })
    host.appendChild(b)
  }
  // The balls tile, alongside the parts — the other half of the trade.
  const poorB = r.score < SHOP.ballPrice
  const bb = document.createElement('button')
  bb.className = 'offer'
  bb.disabled = poorB
  if (poorB) bb.style.opacity = '.45'
  bb.innerHTML =
    `<span class="nm">${SHOP.ballBundle} BALLS</span><span class="jp2">玉</span>` +
    `<span class="bl">${fmt(SHOP.ballPrice)} SCORE</span>` +
    `<span class="dt">Steel, by the hundred. Booked on the ledger's own line — bought, not won, ` +
    `not conjured. The T key still hands them out free; this is for players who want to have ` +
    `paid.</span>`
  bb.addEventListener('click', () => {
    synth.click()
    if (run.buyBalls()) { drainRun(); syncShop() }
  })
  host.appendChild(bb)

  const skip = $('#brSkip')
  skip.childNodes[0].textContent = 'BACK TO THE FLOOR'
  skip.querySelector('small').textContent = 'the shelf keeps; leaving costs nothing'
}

$('#brSkip').addEventListener('click', () => {
  synth.click()
  if (run && run.sandbox) { go('play'); return }
  run.skip(); afterDraft()
})

/** The draft moved on: either deal again, or descend. */
function afterDraft () {
  drainRun()
  if (run.status === 'cleared') { syncBackroom(); return }
  buildFloor()
  go('play')
  banner(run.floor > FLOORS ? `OVERTIME ${run.floor - FLOORS}` : `FLOOR ${run.floor}`,
    `${fmt(run.quota)} to clear · ${run.ballsLeft} balls`)
}

// ── the end ────────────────────────────────────────────────────────────────

function endRun () {
  const unlocked = recordRun(state.meta, run, Date.now())
  save()
  $('#roHead').textContent = run.cleared ? 'THE MACHINE GAVE UP FIRST' : 'THE RUN ENDS'
  $('#roScore').textContent = fmt(run.score)
  const deepest = run.floor
  $('#roSub').textContent = run.cleared
    ? `Cleared all ${FLOORS} floors and went ${deepest - FLOORS} deep into overtime before ` +
      `floor ${deepest} out-ran the board — ${fmt(run.quota - run.floorScore)} short with an ` +
      `empty tray. ${run.loadout.parts.length} parts fitted; longest chain ${run.bestChain}.`
    : `Floor ${deepest} wanted ${fmt(run.quota)} and the tray ran out ` +
      `${fmt(run.quota - run.floorScore)} short. ${run.loadout.parts.length} parts fitted; ` +
      `longest chain ${run.bestChain}.`
  const host = $('#roUnlocks')
  host.textContent = ''
  for (const k of unlocked) {
    const d = document.createElement('div')
    d.textContent = `UNLOCKED — ${CABINETS[k].label} ${CABINETS[k].jp}`
    host.appendChild(d)
  }
  go('runover')
}

$('#roAgain').addEventListener('click', () => {
  synth.click()
  startRun(state.cab || 'floor')
  go('play')
})

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
    // Changing class starts a new machine, and a new machine mid-run would
    // silently delete the run — the options sheet is reachable from the play
    // screen. During a run the CABINET owns the spec, so this is refused
    // outright rather than allowed to quietly cost somebody eight floors.
    // A sandbox restarts freely; its wallet is the cost the player accepted.
    if (run && !run.sandbox && run.status !== 'failed') {
      banner('NOT MID-RUN', 'the cabinet chose the class — this is a FREE PLAY setting')
      return
    }
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
  // The unlock ladder is part of "no memory of you" and must go with the rest.
  // Leaving it behind would make the reset a lie in the player's favour, which
  // is still a lie.
  state.meta = newMeta()
  run = null
  newSession()
  syncMeta()
  banner('FORGOTTEN', 'the machine has no memory of you — cabinets relocked')
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
  if (e.key === 'Escape') { go('title'); return }   // a run survives in memory; see the title menu
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
  if (e.key === 'r' || e.key === 'R') {
    // ROUTE MODE — the recorder's data, rendered (operator's design). The
    // recording is always on; this key only changes what is drawn, so it is
    // free to toggle mid-flight and safe to leave on: an instrument, not a
    // mode of play.
    renderer.testMode = !renderer.testMode
    banner(renderer.testMode ? 'ROUTE MODE' : 'ROUTE MODE OFF',
      renderer.testMode
        ? 'every path, launcher to pocket — the colour was always there, just invisible'
        : 'the stories keep recording; press R to see them again')
  }
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
    //
    // Not during a RUN. The whole roguelike rests on the tray being a clock,
    // and a key that refills the clock is not a difficulty option, it is the
    // absence of a game. FREE PLAY is where the frictionless exhibit lives —
    // its sandbox run is scoreboard, not clock, so the conjure stays.
    if (run && !run.sandbox) {
      banner('NOT IN A RUN', 'the tray is the clock — FREE PLAY has no clock at all')
    } else {
      machine.addTokens(500)
      banner('+500 CONJURED', 'noted in the ledger')
    }
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
  // clientHeight INCLUDES padding, and the floor bar reserves its space as
  // stage padding (the `.quota` rule) — subtract it or the canvas is fitted
  // into room the bar is standing in.
  const cs = getComputedStyle(stage)
  const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
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
  // Clamped at BOTH ends. The ceiling has always been here — a backgrounded tab
  // returns with a huge delta and the physics must not try to integrate it in
  // one go. The FLOOR is new, and it was a real defect: `t - lastT` can come
  // back negative whenever something else has advanced the clock (the manual
  // tick() below, a tab restore, a system clock step), and a negative dt runs
  // the simulation BACKWARDS. Observed live: `sinceLaunch` at −2.383 s, so the
  // launcher had to wait two and a half seconds to be allowed to fire again,
  // the board filled with balls that had integrated in reverse, and the foul
  // rate read 75% where the instrument measures 4%. It presented as a channel
  // jam, which is a real mechanic, which is what made it convincing.
  const dt = Math.max(0, Math.min(0.05, t - lastT || 0.016))
  lastT = t
  tick(dt, t)
}

/**
 * One frame of everything, split out from the rAF callback so it can be driven
 * by hand.
 *
 * This is not a stylistic refactor. A backgrounded or hidden tab throttles
 * requestAnimationFrame to nothing, and the in-app preview pane reports
 * `document.hidden === true` — so a browser-automation harness watching this
 * game sees a frozen board and no way to tell a hang from a throttle. Every
 * verification this project does through a browser (see docs/HANDOFF.md) runs
 * through `__pachinkode.tick()` for exactly that reason: the harness supplies
 * the clock the browser is refusing to.
 *
 * It takes `dt` rather than a timestamp, so a harness can also run a whole
 * floor in a loop faster than real time.
 */
function tick (dt, t = lastT) {
  // Never advance the simulation by a non-positive step, whoever asked. The
  // Machine's clocks (`sinceLaunch`, the heat decays, the round timers) all
  // assume monotonic time and none of them are written to survive going
  // backwards — see frame() for what that looked like when it happened.
  if (!(dt > 0)) return
  if (state.screen !== 'play' || !machine) return

  synth.frame()
  impactsThisFrame = 0

  // In a run the tray IS the floor's remaining launches — see run.js. Writing
  // it here rather than letting the Machine keep its own balance is what makes
  // the number under the board and the number in the panel the same number.
  // The sandbox is the exception: there the machine OWNS its balance (that is
  // the exhibit), and the run is scoreboard only.
  if (run && !run.sandbox) machine.tokens = Math.max(0, run.ballsLeft)
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

  // The dopamine model observes; it never acts. So does the run. Both are
  // handed the SAME drained batch — the queue can only be emptied once, and
  // whichever of them called drain() second would otherwise get nothing.
  for (const b of machine.world.balls) dop.visit(b)
  const events = machine.drain()
  handleEvents(events)
  if (run) {
    run.observe(events, dt, { inFlight: machine.world.balls.length })
    drainRun()
  }
  dop.update(dt, { balls: machine.world.balls.length, impacts: impactsThisFrame / dt, t })

  // Uncertainty for the bed: the live uncertainty of the ball closest to a decision.
  let U = 0
  for (const b of machine.world.balls) U = Math.max(U, dop.uncertaintyAt(b.x, b.y))
  synth.updateBed(U, dop.arousal, state.varnish)
  // The rain follows the MEASURED strike rate — counted this frame, not modelled.
  synth.updateRain(impactsThisFrame / dt, state.varnish)
  synth.updateJam(machine.foulHeat, state.varnish)

  // The floor bar syncs BEFORE the draw: on the frame it toggles, it resizes
  // the canvas, and assigning canvas.width resets the bitmap — synced after
  // the draw, the celebration frame painted a moment earlier was wiped and
  // the compositor showed one black frame at the exact quota moment. (Review
  // finding, confirmed: 2d {alpha:false} clears to opaque black.)
  syncFloorbar()
  renderer.draw(machine, dop, state.varnish, dt, run)
  hud.update(machine, dop, state.varnish, run)
  updateTopbar()

  if (bannerTimer > 0) {
    bannerTimer -= dt
    if (bannerTimer <= 0) $('#banner').classList.remove('on')
  }

  // The persisted balance belongs to FREE PLAY. A real run's tray must not
  // write it — the mirror at the top of this function copies the tray into
  // machine.tokens every tick, and persisting that stomped the sandbox's
  // saved balance (including balls BOUGHT with score) the moment a run was
  // played (review finding: buy 100 balls, die on floor 1, and the purchase
  // was gone with no event, no refund, no ledger trace).
  if (!run || run.sandbox) state.tokens = machine.tokens
}

/**
 * The run's own events: score, chain, floor transitions.
 *
 * Separate from `handleEvents` because they are a separate claim. The machine's
 * events say what the board did; these say what the run decided it was worth,
 * and the whole reason the roguelike does not break design law L4 is that those
 * two never get mixed. A score is loud, coloured by magnitude, and completely
 * absent from the simulation.
 */
function drainRun () {
  for (const ev of run.drain()) {
    switch (ev.type) {
      case 'score': {
        // The numeral, thrown up where it was earned, sized and coloured by
        // how big it is. This is the operator's "numbers going up very
        // visibly", now with four orders of magnitude to express.
        renderer.scorePop(ev.x, ev.y, ev.n, ev.chain)
        if (ev.site) renderer.bucketHit(ev.site, scoreTier(ev.n))
        // Deep chains earn a kick and a lamp burst of their own — the board
        // noticing that something sustained is happening, which is precisely
        // what a chain is and what nothing else on the board reports.
        if (ev.chain > 0 && ev.chain % 8 === 0) {
          renderer.lampBurst(Math.min(1, 0.4 + ev.chain / 30))
          renderer.kick(0.10)
          synth.reach(state.varnish)
        }
        break
      }

      case 'quotaMet':
        // The floor does NOT stop. The celebration lands over live play and
        // the door out slides up at the stage's foot (syncFloorbar) — an
        // earlier build froze the board behind a modal here, and the operator
        // ruled the flow must hold. The fanfare is the quota's own voice, not
        // a borrowed koatari: this is the run's scoreboard speaking, and it
        // gets the one sound in the game that belongs to it.
        renderer.kick(0.5)
        renderer.lampBurst(1)
        synth.quota(state.varnish)
        banner('QUOTA MET', 'the floor is still yours — push for parts, or take the door below')
        break

      case 'floorCleared':
        // Quieter than the quota's fanfare, which by now has already played —
        // this is the door actually closing behind you, not the news. Its own
        // milestone voice, NOT a borrowed koatari: floorCleared is the run's
        // scoreboard speaking and banking pays no balls, so a reward-family
        // cue here stamps a Δp=0 'reward' into the log once per floor and
        // poisons the conditioning instrument (review finding — the old
        // jackpot/koatari borrowings were exactly that misfile).
        renderer.kick(0.4)
        renderer.lampBurst(0.8)
        synth.descend(state.varnish)
        break

      case 'draft':
        // The back room. Reached either by banking the tray or by pushing on
        // until it was empty — the floor is genuinely over by the time this
        // fires, which is why it no longer cuts the player off mid-floor.
        machine.cancelCharge()
        firingHeld = false
        // The descent must not survive the floor it was falling for. Banking
        // mid-jackpot is ordinary now — the door stands open through the whole
        // party — and this machine is about to be discarded, so its jackpotEnd
        // can never fire. (Review finding: a 200 s Shepard glissando kept
        // falling under the entire draft and into the next floor.)
        synth.shepardStop()
        if (machine.inJackpot || machine.koatari) synth.gate(false, state.varnish)
        syncBackroom()
        go('backroom')
        break

      case 'runFailed':
        machine.cancelCharge()
        firingHeld = false
        synth.shepardStop()
        endRun()
        break

      case 'runWon':
        banner('十二階  TWELVE FLOORS', 'banked. now find out where it stops')
        break

      case 'fitted':
        // In a run, take() handles the flow and this event is just record.
        // In the sandbox it is the purchase landing: new brass, same session —
        // refit keeps the ledger and the lottery where buildFloor would wipe
        // them. The door refused entry during a party, so refit cannot.
        if (run.sandbox) {
          machine.refit(run.loadout)
          dop = new Dopamine(BOARD.w, BOARD.h)
          renderer.trails.clear()
          renderer.ripples.length = 0
          renderer.bucketFlare.clear()
        }
        break

      case 'ballsBought':
        // The run moved the score; the machine books the balls on its own
        // line. One direction each — the run never touches the machine.
        machine.buyTokens(ev.n)
        break
    }
  }
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
        // A nail struck hard enough to ring ripples in the colour of the
        // value map at that spot — the trails' vocabulary applied to the
        // field. Speed-gated here so the rain's grazes stay quiet; the pool
        // caps itself. See Renderer#rippleLayer.
        if (ev.surface === 'nail' && ev.speed > 0.30) {
          renderer.nailRipple(ev.x, ev.y, ev.speed, dop.valueAt(ev.x, ev.y))
        }
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

      case 'bucket':
        // A bucket is the loudest thing on the screen and was the quietest
        // thing in the room. It gets the tray cascade every other paying
        // pocket gets — the reward in the room's own currency — and nothing
        // new: a bucket pays a ball, so it belongs to the vocabulary that
        // already exists rather than earning a voice of its own. That is
        // Builder 2's rule working as intended (docs/HANDOFF.md): hook the
        // LEDGER, and a payout source added later inherits the family free.
        dop.settle(ev.ball, ev.n)
        dop.push(ev.n)
        renderer.flash(ev.x, ev.y, 0.7)
        renderer.lampBurst(0.5)
        synth.cascade(4, state.varnish)
        break

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
        // A PAID miss is neither: the consolation just handed over balls, so
        // neither the sour unvarnished tone nor the bare-loss dopamine push
        // belongs to it — the cascade announces what actually happened. This
        // gate is also what keeps the 'lose' voice's mechanism-family law
        // true: ungated, half of all logged losses co-occurred with a real
        // payment, Δp ≈ 0.5 against a declared ≈ 0 (review finding).
        if (ev.reach) dop.nearMiss(true)
        else if (!ev.paid) dop.push(-0.8)
        if (!ev.paid) synth.lose(ev.reach, state.varnish)
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
        // Two truthful arms: the sandbox names both faucets; a run names the
        // fact. The old run-mode text advised pressing T — the exact key the
        // run guard refuses — in the only mode the text could still appear
        // (review finding: the shell instructed the player to do the thing
        // its own guard forbids).
        banner('OUT OF TOKENS',
          run && run.sandbox
            ? 'T conjures 500 free — or the shop below sells 100 for 4,000 score'
            : 'the tray is the clock — what is still on the board is all there is')
        break

      case 'pay':
        // Every ball gained, and nothing else. Hooked at the LEDGER rather
        // than at each pocket, so the cue cannot fire unless `won` actually
        // moved — and so any payout source added later inherits it for free.
        // Refunds do not pass through pay(), and must not: a fouled ball
        // returning is a spend reversed, not a gain.
        renderer.rewardPulse(ev.n)
        // The consolation has no pocket handler to cascade from — its balls
        // land in the tray here. Legal for the reward family by construction:
        // this arm of the switch cannot be reached unless the ledger moved.
        if (ev.source === 'hazure') synth.cascade(ev.n, state.varnish)
        break

      case 'sequence':
        // 順目. The run scores it (that pop arrives via the score event); the
        // board acknowledges with lamps only — no new voice, because the cue
        // taxonomy has no honest drawer for an RNG display event that pays
        // score rather than balls, and a borrowed one would misfile.
        renderer.lampBurst(0.5)
        break

      case 'split':
        // The gold ball parting. A mechanism fact with a mechanism voice —
        // one ball became two, audibly and visibly, whatever it later earns.
        renderer.flash(ev.x, ev.y, 0.9)
        renderer.pop(ev.x, ev.y, '×2', 1.0)
        synth.split(state.varnish)
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
  go,
  get run () { return run },
  /** Drive n frames by hand. See tick() — the preview pane reports hidden. */
  tick (n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt, (lastT += dt)) },
  startRun,
  /** Rebuild the board from the run's current loadout — see buildFloor(). */
  buildFloor () { run && buildFloor() },
  /**
   * The route recorder's data: every live ball's full path so far, and the
   * last ROUTE_LOG_MAX completed stories, points of {x, y, v, c} — position
   * plus what the value map believed there, at that moment. Always recording;
   * the R key merely renders it. This is the read-side the testing software
   * will build on.
   */
  routes () {
    return { live: [...renderer.trails.values()], done: [...renderer.routeLog] }
  }
}

requestAnimationFrame(frame)
addEventListener('load', resize)
resize()
