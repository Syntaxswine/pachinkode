// The instrumentation panel.
//
// Design law L6: the board is the spectacle, this is the field notebook lying
// next to it. Small, monospace, low saturation, no animation.
//
// RESHAPED by operator's ruling (2026-07-29): the panel proper carries only
// the four things a player actually plays with — their balls, the score to
// hit, their current score, and the chain. Everything else (the ledger, the
// launcher's diagnostics, the lottery counters, THE MODEL OF YOU, the
// celebration audit, varnish) lives behind the FIELD NOTES door below,
// closed by default. Design law L5 — the machine tells the truth — is not
// repealed: every number is still there, one click down. The exhibit became
// a drawer; the game got the desk.
//
// THE MODEL OF YOU's data did not leave the game with its demotion: the chain
// section's decay bar is the piece of it that turned out to be PLAY — the
// window the player is racing is now the most load-bearing gauge on the
// panel, because the wave asks them to choose between resting (crest odds)
// and feeding it (the multiplier that is most of their score).

import { thresholdCrestSpeed, routeOdds, coinFlipDial } from '../sim/board.js'

const f1 = (x) => x.toFixed(1)
const pct = (x) => (x * 100).toFixed(0) + '%'

export class Hud {
  constructor (el) {
    this.el = el
    this.el.innerHTML = `
      <div class="sect" id="runbox" style="display:none">
        <div class="k" id="rFloor">FLOOR 1</div>
        <div class="q"><span id="rScore">0</span> <span id="rQuotaWrap" style="color:var(--dim);font-size:12px">/ <span id="rQuota">0</span></span></div>
        <div class="qbar" id="rBarWrap"><i id="rBar" style="width:0%"></i></div>
        <div class="stat" id="rBallsRow"><span>balls left</span><span id="rBalls">0</span></div>
        <div class="stat" id="rTotalRow"><span>run total</span><span id="rTotal">0</span></div>
        <div class="stat" id="rSpentRow" style="display:none"><span>spent at the shop</span><span id="rSpent">0</span></div>
        <div class="tiny" id="rParts"></div>
      </div>

      <div class="sect">
        <div class="k" id="kTokens">TOKENS</div>
        <div class="big" id="hTokens">0</div>
        <div class="stat"><span>in play</span><span id="hBalls">0</span></div>
      </div>

      <div class="sect">
        <div class="k">THE CHAIN</div>
        <div class="stat"><span>chain</span><span id="rChain">—</span></div>
        <div class="meter uni"><i id="cBar" style="width:0%"></i></div>
        <div class="tiny" id="cNote"></div>
      </div>

      <button id="hudMoreBtn" class="hudmore" type="button">FIELD NOTES ▸</button>
      <div id="hudMore" style="display:none">

      <div class="sect">
        <div class="k">THE LEDGER</div>
        <div class="stat"><span>spent</span><span id="hSpent">0</span></div>
        <div class="stat"><span>won back</span><span id="hWon">0</span></div>
        <div class="stat"><span>conjured</span><span id="hConj">0</span></div>
        <div class="stat" id="hBoughtRow" style="display:none"><span>bought with score</span><span id="hBought">0</span></div>
        <div class="stat"><span>return</span><span id="hRtp">—</span></div>
        <div class="tiny" id="hYen"></div>
      </div>

      <div class="sect">
        <div class="k">THE LAUNCHER</div>
        <div class="stat"><span>base</span><span id="hDial">—</span></div>
        <div class="stat"><span>pull</span><span id="hPull">—</span></div>
        <div class="stat"><span>route</span><span id="hRoute">—</span></div>
        <div class="stat"><span>rate cap</span><span id="hRate">—</span></div>
        <div class="stat"><span>scatter</span><span id="hScat">—</span></div>
        <div class="meter uni"><i id="mScat" style="width:0%"></i></div>
        <div class="stat"><span>shots</span><span id="hShots">0</span></div>
        <div class="tiny" id="hLaunchNote"></div>
      </div>

      <div class="sect">
        <div class="k">THE LOTTERY</div>
        <div class="stat"><span>big 大当たり</span><span id="hOdds">—</span></div>
        <div class="stat"><span>small 小当たり</span><span id="hKoOdds">—</span></div>
        <div class="stat"><span>spins</span><span id="hSpins">0</span></div>
        <div class="stat"><span>held 保留</span><span id="hHolds">0/4</span></div>
        <div class="stat"><span>jackpots</span><span id="hJack">0</span></div>
        <div class="stat"><span>small wins</span><span id="hKo">0</span></div>
        <div class="tiny" id="hLottery"></div>
      </div>

      <div class="sect">
        <div class="k">THE MODEL OF YOU</div>
        <div class="stat"><span>dopamine δ</span><span id="hDa">—</span></div>
        <div class="meter uni"><i id="mDa" style="width:0%"></i></div>
        <div class="stat"><span>arousal</span><span id="hAro">—</span></div>
        <div class="meter uni"><i id="mAro" style="width:0%"></i></div>
        <div class="stat"><span>pleasantness</span><span id="hVal">—</span></div>
        <div class="meter"><i id="mVal" style="width:0%"></i></div>
        <div class="stat"><span>motivation</span><span id="hMot">—</span></div>
        <div class="meter"><i id="mMot" style="width:0%"></i></div>
        <div class="tiny" id="hDiss"></div>
      </div>

      <div class="sect">
        <div class="k">WHAT IT CELEBRATED</div>
        <div class="stat"><span>parties thrown</span><span id="hCeleb">0</span></div>
        <div class="stat"><span>actually ahead</span><span id="hDeserved">0</span></div>
        <div class="tiny" id="hLdw"></div>
      </div>

      <div class="sect">
        <div class="k">VARNISH</div>
        <div class="stat"><span>presentation</span><span id="hVarn">100%</span></div>
        <div class="tiny">Physics, odds and payouts are identical at every setting.
          Press <b>V</b> to toggle.</div>
      </div>

      </div>`
    for (const id of ['runbox', 'kTokens', 'rFloor', 'rScore', 'rQuota', 'rBar', 'rBalls',
      'rChain', 'rTotal', 'rParts', 'rQuotaWrap', 'rBarWrap', 'rBallsRow', 'rTotalRow',
      'rSpentRow', 'rSpent', 'hBoughtRow', 'hBought',
      'hTokens', 'hBalls', 'hSpent', 'hWon', 'hConj', 'hRtp', 'hYen',
      'hDial', 'hPull', 'hRoute', 'hRate', 'hScat', 'mScat', 'hShots', 'hLaunchNote',
      'hOdds', 'hKoOdds', 'hSpins', 'hHolds', 'hJack', 'hKo', 'hLottery', 'hDa', 'mDa', 'hAro', 'mAro',
      'hVal', 'mVal', 'hMot', 'mMot', 'hDiss', 'hCeleb', 'hDeserved', 'hLdw', 'hVarn',
      'cBar', 'cNote', 'hudMore', 'hudMoreBtn']) {
      this[id] = this.el.querySelector('#' + id)
    }
    this.threshold = thresholdCrestSpeed()
    // The drawer. Closed is the resting state — the game got the desk.
    this.hudMoreBtn.addEventListener('click', () => {
      const open = this.hudMore.style.display === 'none'
      this.hudMore.style.display = open ? '' : 'none'
      this.hudMoreBtn.textContent = open ? 'FIELD NOTES ▾' : 'FIELD NOTES ▸'
    })
  }

  update (m, dop, varnish, run = null) {
    // The run box, when there is a run. In FREE PLAY it is absent entirely
    // rather than showing zeroes — a quota of nothing is not information.
    this.runbox.style.display = run ? '' : 'none'
    this.kTokens.textContent = run && !run.sandbox ? 'THE TRAY' : 'TOKENS'
    if (run) {
      const sb = !!run.sandbox
      // The sandbox shows the WALLET where a run shows the floor: no quota,
      // no bar, no balls-left (the machine owns its balance there), and a
      // spent line so the trade is a running total, not a vanish.
      this.rQuotaWrap.style.display = sb ? 'none' : ''
      this.rBarWrap.style.display = sb ? 'none' : ''
      this.rBallsRow.style.display = sb ? 'none' : ''
      this.rTotalRow.style.display = sb ? 'none' : ''
      this.rSpentRow.style.display = sb ? '' : 'none'
      if (sb) {
        this.rFloor.textContent = 'FREE PLAY — SCORE IS A WALLET'
        this.rScore.textContent = Math.round(run.score).toLocaleString('en-US')
        this.rSpent.textContent = Math.round(run.spent).toLocaleString('en-US')
      } else {
        const over = run.floor > 12
        this.rFloor.textContent = over ? `OVERTIME ${run.floor - 12}` : `FLOOR ${run.floor} OF 12`
        this.rScore.textContent = Math.round(run.floorScore).toLocaleString('en-US')
        this.rQuota.textContent = Math.round(run.quota).toLocaleString('en-US')
        this.rBar.style.width = (run.progress * 100).toFixed(1) + '%'
        // The stylesheet has always promised a teal bar for a met quota; wire it.
        // It matters now that the floor keeps playing past the line — the panel
        // should agree with the floor bar about which side of it you are on.
        this.rBar.parentElement.classList.toggle('met', !!run.metQuota)
        this.rBalls.textContent = Math.max(0, run.ballsLeft)
        this.rTotal.textContent = Math.round(run.score).toLocaleString('en-US')
      }
      // Every part fitted, named. A roguelike whose build is invisible is a
      // roguelike where the player cannot reason about the next pick.
      const counts = {}
      for (const id of run.loadout.parts) counts[id] = (counts[id] || 0) + 1
      this.rParts.textContent = Object.entries(counts)
        .map(([id, n]) => (n > 1 ? `${id}×${n}` : id)).join(' · ') || 'stock board'
    }

    // THE CHAIN — the panel's live gauge. The bar is the decay window
    // draining: the clock the player races when the wave tempts them to rest.
    // The note states the biggest measured fact about scoring (50–79% of all
    // points are the multiplier's) the moment it becomes true of THIS run.
    if (run && run.chain > 0) {
      this.rChain.textContent = `${run.chain} · ×${run.mult.toFixed(1)}`
      const w = Math.max(0, Math.min(1, run.chainLeft / run.loadout.comboWindow))
      this.cBar.style.width = (w * 100).toFixed(0) + '%'
      const P = run.provenance
      const share = P.fromChain / Math.max(1, P.base + P.fromChain)
      this.cNote.textContent = share > 0.4
        ? `the multiplier is ${Math.round(share * 100)}% of everything you have scored`
        : ''
    } else {
      this.rChain.textContent = '—'
      this.cBar.style.width = '0%'
      this.cNote.textContent = ''
    }

    this.hTokens.textContent = m.tokens
    this.hBalls.textContent = m.world.balls.length
    this.hSpent.textContent = m.spent
    this.hWon.textContent = m.won
    this.hConj.textContent = m.conjured
    // The fourth ledger line appears only once it is non-zero — three lines
    // is the exhibit's resting state, and a permanent 0 would beg a question
    // the run modes never answer.
    this.hBoughtRow.style.display = m.bought > 0 ? '' : 'none'
    this.hBought.textContent = m.bought
    this.hRtp.textContent = m.spent > 40 ? pct(m.rtp) : '—'

    // The honest ledger. Ball rental has been capped at ¥4 since 1978, and the
    // 100-balls-per-minute launch ceiling exists so that ¥400 a minute is the
    // fastest a person is permitted to lose money at one of these.
    const yen = m.spent * 4
    this.hYen.textContent = `${m.spent} balls rented · ¥${yen.toLocaleString()} at the ¥4 ceiling`

    // The launcher. Scatter is the live standard deviation the next shot gets,
    // which is a function of how hard the mechanism has been worked — so this
    // needle is the price of firing fast, shown before you pay it.
    this.hDial.textContent = m.dial.toFixed(2)
    const pulled = m.power - m.dial > 0.005
    this.hPull.textContent = pulled ? Math.round(m.power * 100) + '%' : 'at base'
    this.hPull.style.color = pulled ? 'var(--hot)' : 'var(--dim)'
    this.hRate.textContent = `${Math.round(60 / m.fireInterval)}/min` +
      (m.fireInterval >= 0.6 ? ' · legal' : '')
    // Route odds, measured rather than derived, and read from the LIVE pull so
    // drawing the hammer back sweeps them in real time. The split between
    // left-hitting and right-hitting is probabilistic — a ball's surviving
    // energy at the top of the rail varies chaotically with how it rattled on
    // the way up — so a LEFT/RIGHT label would be claiming a certainty the
    // machine does not have.
    const pRight = routeOdds(m.power)
    const near = Math.abs(pRight - 0.5) < 0.12
    // During a channel jam the solo-shot table is outside its measured domain
    // — the split is collision-dominated and genuinely unknowable — so the
    // figure greys and says what it is rather than asserting through it.
    const jammed = m.foulHeat > 1.6
    this.hRoute.textContent = `左 ${Math.round((1 - pRight) * 100)} : ${Math.round(pRight * 100)} 右` +
      (jammed ? ' · solo' : '')
    this.hRoute.style.color = jammed ? 'var(--faint)' : near ? 'var(--hot)' : 'var(--ink)'
    const jn = Math.min(1, Math.max(0, (m.nextJitter - 0.0035) / (0.026 - 0.0035)))
    this.hScat.textContent = '±' + (m.nextJitter * 100).toFixed(2) + '%'
    this.mScat.style.width = (jn * 100).toFixed(0) + '%'
    this.mScat.style.background = jn > 0.55 ? '#d4574a' : 'var(--hot)'
    this.hShots.textContent = m.shots
    // The jam outranks everything: it is the one launcher state that actively
    // eats the player's stream, and it has a remedy worth stating.
    const jam = m.foulHeat > 1.6
    this.hLaunchNote.textContent = jam
      ? 'CHANNEL JAM — fouled balls are falling back into the stream and robbing the climbers. Ease off; it clears in a second or two.'
      : jn > 0.6
        ? 'Firing flat out. The hammer and the cradle never settle, and the shot spreads.'
        : jn < 0.2
          ? 'Rested. Single shots hold the dial almost exactly.'
          : ''
    this.hLaunchNote.style.color = jam ? 'var(--hot)' : ''

    if (m.S.flapper) {
      // The flapper has no lottery to report — the drawer says so instead of
      // printing dead zeroes that beg questions.
      this.hOdds.textContent = '—'
      this.hKoOdds.textContent = '—'
      this.hSpins.textContent = '—'
      this.hHolds.textContent = '—'
      this.hJack.textContent = '—'
      this.hKo.textContent = '—'
      this.hLottery.textContent =
        `No lottery in this cabinet. The navel works the wings (${m.flaps} openings); the wings pay ${m.S.tulipPay}.`
    } else {
      // Breathing odds: the wave's live figure first, the book figure beside it.
      this.hOdds.textContent = `1 / ${Math.round(m.oddsNow)} · book ${m.odds}`
      this.hKoOdds.textContent = '1 / ' + m.S.koatariOdds
      this.hSpins.textContent = m.spins
      this.hHolds.textContent = `${m.holds}/4`
      this.hJack.textContent = m.jackpots
      this.hKo.textContent = m.koataris
      this.hLottery.textContent = m.kakuhen > 0
        ? `確変 KAKUHEN — ${m.kakuhen} spins left at raised odds`
        : 'The start pocket pays 3 and buys one ticket. Small win: the attacker blinks open. Big win: it stays.'
    }

    const da = Math.max(0, Math.min(1, (dop.da - 1) / 2.7))
    this.hDa.textContent = (dop.delta >= 0 ? '+' : '') + dop.delta.toFixed(2)
    this.mDa.style.width = (da * 100).toFixed(0) + '%'
    this.hAro.textContent = pct(dop.arousal)
    this.mAro.style.width = pct(dop.arousal)

    const bar = (v, el, node) => {
      const w = Math.abs(v) * 50
      node.style.width = w + '%'
      node.style.left = v >= 0 ? '50%' : (50 - w) + '%'
      node.style.background = v >= 0 ? 'var(--hot)' : 'var(--cold)'
      el.textContent = (v >= 0 ? '+' : '') + v.toFixed(2)
    }
    bar(dop.valence, this.hVal, this.mVal)
    bar(dop.motivation, this.hMot, this.mMot)

    // The near-miss dissociation, called out when it happens: less pleasant AND
    // more motivating at the same time (Clark et al. 2009, Neuron 61(3)).
    this.hDiss.textContent = (dop.valence < -0.06 && dop.motivation > 0.06)
      ? 'Less pleasant. More motivating. Both at once — that is the near-miss.'
      : ''

    this.hCeleb.textContent = m.celebrations
    this.hDeserved.textContent = m.netPositiveEvents
    const heso = m.spins
    this.hLdw.textContent = heso > 4
      ? `${heso} start-pocket fanfares. Each paid 3 and cost about 30 to reach — ` +
        `a net loss the machine chose to sound like a win.`
      : ''

    this.hVarn.textContent = pct(varnish)
  }
}
