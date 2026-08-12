// Browser-only visual QA harness. Example:
//   http://localhost:8790/tools/board-preview.html?cab=kawadai

import { Machine, TULIP_PAY } from '../src/sim/machine.js'
import { Dopamine } from '../src/sim/dopamine.js'
import { BOARD } from '../src/sim/board.js'
import { Run } from '../src/sim/run.js'
import { CABINETS } from '../src/sim/cabinets.js'
import { MOTIFS } from '../src/sim/motifs.js'
import { Renderer, registerMotifArt } from '../src/render/board-render.js'
import { riverFestivalArt } from '../src/render/motif-art.js'
import { PresentationDirector } from '../src/render/presentation.js'

const key = new URLSearchParams(location.search).get('cab') || 'kawadai'
const cab = CABINETS[key] || CABINETS.kawadai
const run = new Run(cab, 812)
const machine = new Machine({ seed: 812, tokens: 5000, fireInterval: 0.12, loadout: run.loadout })
const dop = new Dopamine(BOARD.w, BOARD.h)
const show = new PresentationDirector()
const renderer = new Renderer(document.querySelector('#board'))
registerMotifArt('tanuki', { src: '../images/tanuki-balls.png', ...MOTIFS.tanuki.img, alpha: 0.34 })
registerMotifArt('kawa', { draw: riverFestivalArt, alpha: 1 })
document.querySelector('#label').textContent = `${cab.label} ${cab.jp} · LIVE PHYSICS PREVIEW`
machine.dial = 0.20
machine.firing = true
show.trigger('floor')

function size () {
  const h = Math.max(420, innerHeight - 24)
  renderer.resize(Math.min(innerWidth - 24, h * BOARD.w / BOARD.h), h)
}
addEventListener('resize', size)
size()

let last = performance.now()
function frame (now) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
  last = now
  machine.step(dt)
  for (const b of machine.world.balls) dop.visit(b)
  for (const ev of machine.drain()) {
    if (ev.type === 'warp') dop.carry(ev.ball, ev.into)
    else if (ev.type === 'heso') { dop.push(dop.settle(ev.ball, 14)); renderer.flash(ev.x, ev.y, 1); show.trigger('pocket') }
    else if (ev.type === 'bucket') { dop.push(dop.settle(ev.ball, ev.n)); renderer.flash(ev.x, ev.y, 0.7); show.trigger('pocket') }
    else if (ev.type === 'tulip') dop.push(dop.settle(ev.ball, TULIP_PAY))
    else if (ev.type === 'attacker') dop.push(dop.settle(ev.ball, machine.S.payPerEntry))
    else if ((ev.type === 'drain' || ev.type === 'foul') && ev.ball) dop.push(dop.settle(ev.ball, 0))
  }
  dop.update(dt, { balls: machine.world.balls.length, impacts: 0 })
  show.update(dt)
  renderer.draw(machine, dop, 1, dt, run, show.snapshot(), false)
}
requestAnimationFrame(frame)
