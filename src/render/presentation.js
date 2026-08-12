// Event choreography for the cabinet's electric layer.
//
// This object reads named facts and produces a short-lived scene description.
// It knows no Machine, Run, odds, geometry, or payout values, and therefore
// cannot influence any of them. Renderer and audio remain consumers only.

const SCENES = {
  pocket: { duration: 0.75, priority: 1, pattern: 'burst', hue: 42 },
  warp: { duration: 1.05, priority: 2, pattern: 'tunnel', hue: 188 },
  chain: { duration: 1.15, priority: 2, pattern: 'steps', hue: 294 },
  reach: { duration: 2.45, priority: 4, pattern: 'converge', hue: 348 },
  koatari: { duration: 2.1, priority: 5, pattern: 'alternating', hue: 44 },
  quota: { duration: 2.6, priority: 6, pattern: 'wipe', hue: 164 },
  jackpotBuild: { duration: 2.8, priority: 7, pattern: 'chase', hue: 26 },
  jackpot: { duration: 8.0, priority: 8, pattern: 'festival', hue: 46 },
  floor: { duration: 1.8, priority: 6, pattern: 'curtain', hue: 204 }
}

export class PresentationDirector {
  constructor () { this.reset() }

  reset () {
    this.scene = null
    this.serial = 0
  }

  /**
   * Start a named scene. A stronger active scene cannot be stomped by pocket
   * chatter; once it reaches its afterglow, the next fact may take the lights.
   */
  trigger (kind, strength = 1) {
    const spec = SCENES[kind]
    if (!spec) return false
    const active = this.scene
    if (active && active.age < active.duration * 0.72 && spec.priority < active.priority) return false
    // THE ATTACK FLOOR, and it is a safety fix, not a taste one.
    //
    // Every scene restarts at age 0, and `snapshot()` re-attacks from nothing
    // over 140 ms. `intensity` is the sole gate on both new light layers — all
    // forty-eight marquee lamps and the full-field rays — so an incoming scene
    // used to black the whole field out and bring it back inside a seventh of
    // a second. Pocket chatter is same-priority, so it was not refused: measured
    // on the stock board at ARCADE, 0.41 collapses per second, four inside the
    // busiest second. That is a full-field flicker above three per second, and
    // REDUCED EFFECTS did not remove it (that mode freezes travel and dims, but
    // `intensity` still comes from this attack).
    //
    // Carrying the outgoing scene's brightness in as the new scene's attack
    // floor makes the hand-over monotonic: the lights may change colour and may
    // step DOWN to a quieter scene, but they can no longer go dark and come
    // straight back. A fresh scene over darkness still attacks normally.
    const carry = active ? this.snapshot().intensity : 0
    this.scene = {
      ...spec,
      kind,
      age: 0,
      floor: Math.max(0, Math.min(1, carry)),
      strength: Math.max(0.15, Math.min(1.35, strength)),
      serial: ++this.serial
    }
    return true
  }

  update (dt) {
    if (!this.scene || !(dt > 0)) return
    this.scene.age += dt
    if (this.scene.age >= this.scene.duration) this.scene = null
  }

  snapshot () {
    const s = this.scene
    if (!s) return { kind: 'idle', pattern: 'idle', intensity: 0, phase: 0, hue: 42, serial: this.serial }
    const attack = Math.min(1, Math.max(s.floor || 0, s.age / 0.14))
    const release = Math.min(1, (s.duration - s.age) / Math.min(0.65, s.duration * 0.3))
    return {
      kind: s.kind,
      pattern: s.pattern,
      hue: s.hue,
      phase: s.age / s.duration,
      time: s.age,
      intensity: Math.max(0, attack * release * s.strength),
      serial: s.serial
    }
  }
}

export { SCENES as PRESENTATION_SCENES }
