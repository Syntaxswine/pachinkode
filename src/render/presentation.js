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
    this.scene = {
      ...spec,
      kind,
      age: 0,
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
    const attack = Math.min(1, s.age / 0.14)
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
