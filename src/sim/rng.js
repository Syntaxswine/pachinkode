// Deterministic PRNG. Law L3: nothing in src/sim may call Math.random().
//
// sfc32 (Small Fast Counter, Chris Doty-Humphrey / PractRand). Passes PractRand
// well past 32 TB, has a 128-bit state, and is a handful of integer ops. We need
// determinism far more than we need cryptographic quality: the same seed must
// replay the same session in Node and in the browser, forever.

export function makeRng (seed) {
  // Expand a single integer or string seed into four 32-bit words.
  let h = 0x9e3779b9 ^ hashSeed(seed)
  const next32 = () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  let a = next32(), b = next32(), c = next32(), d = next32()

  const rng = () => {
    a |= 0; b |= 0; c |= 0; d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }

  // Warm up: discard the first few outputs so nearby seeds decorrelate.
  for (let i = 0; i < 12; i++) rng()

  rng.int = (n) => Math.floor(rng() * n)
  rng.range = (lo, hi) => lo + rng() * (hi - lo)
  rng.bool = (p) => rng() < p
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)]
  // Box-Muller, one value per call (the spare is discarded to keep the call
  // count a pure function of the caller's sequence — see the RNG-cascade trap).
  rng.normal = (mean = 0, sd = 1) => {
    const u = Math.max(rng(), 1e-12), v = rng()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  rng.state = () => [a, b, c, d]
  return rng
}

function hashSeed (seed) {
  if (typeof seed === 'number') return seed | 0
  const s = String(seed ?? 'pachinkode')
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
