// Minimal 2-vector helpers. The hot physics loop in world.js uses scalars
// directly to avoid allocation; these exist for geometry construction and
// rendering, where clarity beats a few objects per frame.

export const v = (x = 0, y = 0) => ({ x, y })
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s })
export const dot = (a, b) => a.x * b.x + a.y * b.y
export const cross = (a, b) => a.x * b.y - a.y * b.x
export const len = (a) => Math.hypot(a.x, a.y)
export const len2 = (a) => a.x * a.x + a.y * a.y
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l } }
/** Left-hand perpendicular; also the 2-D analogue of (ω ẑ) × r for unit ω. */
export const perp = (a) => ({ x: -a.y, y: a.x })
export const rot = (a, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}
export const lerp = (a, b, t) => a + (b - a) * t
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)

/** Closest point to p on the segment ab, plus the parameter t along it. */
export function closestOnSegment (p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y
  const l2 = abx * abx + aby * aby
  if (l2 < 1e-18) return { x: a.x, y: a.y, t: 0 }
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { x: a.x + abx * t, y: a.y + aby * t, t }
}
