// The instrumentation panel.
//
// Design law L6: the board is the spectacle, this is the field notebook lying
// next to it. Small, monospace, low saturation, no animation.
//
// Design law L5: the machine tells the truth. Everything a regulated parlour is
// allowed to hide is shown here — the live return-to-player, the real odds, the
// number of tokens the player conjured out of nothing rather than won, and the
// gap between wins the machine celebrated and wins that were actually net
// positive. That last pair is the point of the whole exercise.

import { thresholdCrestSpeed } from '../sim/board.js'

const f1 = (x) => x.toFixed(1)
const pct = (x) => (x * 100).toFixed(0) + '%'

export class Hud {
  constructor (el) {
    this.el = el
    this.el.innerHTML = `
      <div class="sect">
        <div class="k">TOKENS</div>
        <div class="big" id="hTokens">0</div>
        <div class="stat"><span>in play</span><span id="hBalls">0</span></div>
      </div>

      <div class="sect">
        <div class="k">THE LEDGER</div>
        <div class="stat"><span>spent</span><span id="hSpent">0</span></div>
        <div class="stat"><span>won back</span><span id="hWon">0</span></div>
        <div class="stat"><span>conjured</span><span id="hConj">0</span></div>
        <div class="stat"><span>return</span><span id="hRtp">—</span></div>
        <div class="tiny" id="hYen"></div>
      </div>

      <div class="sect">
        <div class="k">THE LOTTERY</div>
        <div class="stat"><span>odds</span><span id="hOdds">—</span></div>
        <div class="stat"><span>spins</span><span id="hSpins">0</span></div>
        <div class="stat"><span>held 保留</span><span id="hHolds">0/4</span></div>
        <div class="stat"><span>jackpots</span><span id="hJack">0</span></div>
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
      </div>`
    for (const id of ['hTokens', 'hBalls', 'hSpent', 'hWon', 'hConj', 'hRtp', 'hYen',
      'hOdds', 'hSpins', 'hHolds', 'hJack', 'hLottery', 'hDa', 'mDa', 'hAro', 'mAro',
      'hVal', 'mVal', 'hMot', 'mMot', 'hDiss', 'hCeleb', 'hDeserved', 'hLdw', 'hVarn']) {
      this[id] = this.el.querySelector('#' + id)
    }
    this.threshold = thresholdCrestSpeed()
  }

  update (m, dop, varnish) {
    this.hTokens.textContent = m.tokens
    this.hBalls.textContent = m.world.balls.length
    this.hSpent.textContent = m.spent
    this.hWon.textContent = m.won
    this.hConj.textContent = m.conjured
    this.hRtp.textContent = m.spent > 40 ? pct(m.rtp) : '—'

    // The honest ledger. Ball rental has been capped at ¥4 since 1978, and the
    // 100-balls-per-minute launch ceiling exists so that ¥400 a minute is the
    // fastest a person is permitted to lose money at one of these.
    const yen = m.spent * 4
    this.hYen.textContent = `${m.spent} balls rented · ¥${yen.toLocaleString()} at the ¥4 ceiling`

    this.hOdds.textContent = '1 / ' + (m.kakuhen > 0 ? m.S.kakuhenOdds : m.S.jackpotOdds)
    this.hSpins.textContent = m.spins
    this.hHolds.textContent = `${m.holds}/4`
    this.hJack.textContent = m.jackpots
    this.hLottery.textContent = m.kakuhen > 0
      ? `確変 KAKUHEN — ${m.kakuhen} spins left at raised odds`
      : 'The start pocket pays 3 and buys one ticket. It does not decide anything.'

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
