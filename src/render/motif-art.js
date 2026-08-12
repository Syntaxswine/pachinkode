// Procedural printed art for code-native picture boards.
// Geometry stays in sim/motifs.js; these pixels are lacquer only.

export function riverFestivalArt (ctx, { R, P, motif, time = 0 }) {
  const pts = motif.contour
  if (!pts.length) return

  ctx.save()
  ctx.lineJoin = 'round'

  // The broad water ribbon inside the nail banks.
  const water = ctx.createLinearGradient(R.X(0.14), R.Y(0.17), R.X(0.30), R.Y(0.40))
  water.addColorStop(0, `hsla(194 78% 55% / ${0.16 + 0.03 * Math.sin(time * 0.7)})`)
  water.addColorStop(0.55, 'hsla(214 76% 48% / .18)')
  water.addColorStop(1, 'hsla(178 72% 44% / .15)')
  ctx.beginPath()
  ctx.moveTo(R.X(pts[0][0]), R.Y(pts[0][1]))
  for (let i = 1; i < pts.length; i++) ctx.lineTo(R.X(pts[i][0]), R.Y(pts[i][1]))
  ctx.closePath()
  ctx.fillStyle = water
  ctx.fill()

  // Current lines bend around the heso whirlpool; they are visual narrative,
  // not collision guides, and disappear with varnish.
  ctx.strokeStyle = 'hsla(190 90% 76% / .24)'
  ctx.lineWidth = Math.max(1, R.S(0.0012))
  for (let i = 0; i < 4; i++) {
    const x = 0.188 + i * 0.021
    ctx.beginPath()
    ctx.moveTo(R.X(x), R.Y(0.184))
    ctx.bezierCurveTo(R.X(x - 0.025), R.Y(0.245), R.X(x + 0.030), R.Y(0.292), R.X(0.220), R.Y(0.344))
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(R.X(motif.heso.x), R.Y(motif.heso.y), R.S(0.020), 0.2, Math.PI * 1.8)
  ctx.stroke()

  // A broken bridge leaves the physical central descent visibly open.
  ctx.strokeStyle = 'hsla(30 62% 62% / .30)'
  ctx.lineWidth = Math.max(2, R.S(0.004))
  for (const [a, b] of [[0.142, 0.198], [0.244, 0.299]]) {
    ctx.beginPath(); ctx.moveTo(R.X(a), R.Y(0.276)); ctx.lineTo(R.X(b), R.Y(0.276)); ctx.stroke()
  }

  // Lanterns mark the banks in the same warm hue as the cabinet marquee.
  const lanterns = [[0.154, 0.205], [0.292, 0.230], [0.145, 0.310], [0.282, 0.337]]
  for (const [x, y] of lanterns) {
    const g = ctx.createRadialGradient(R.X(x), R.Y(y), 0, R.X(x), R.Y(y), R.S(0.014))
    g.addColorStop(0, 'hsla(44 100% 78% / .58)')
    g.addColorStop(1, 'hsla(28 95% 48% / 0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(R.X(x), R.Y(y), R.S(0.014), 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'hsla(38 92% 68% / .52)'
    ctx.fillRect(R.X(x - 0.004), R.Y(y - 0.006), R.S(0.008), R.S(0.012))
  }

  ctx.font = `600 ${Math.max(7, R.S(0.0065))}px ui-monospace, monospace`
  ctx.fillStyle = `hsla(${P.hue} ${Math.round(P.saturation * 100)}% 76% / .42)`
  ctx.textAlign = 'center'
  ctx.fillText('源  SOURCE', R.X(0.220), R.Y(0.184))
  ctx.fillText('橋  BRIDGE', R.X(0.220), R.Y(0.268))
  ctx.fillText('渦  WHIRLPOOL', R.X(0.220), R.Y(0.333))
  ctx.fillText('河口  HARBOUR', R.X(0.220), R.Y(0.407))
  ctx.restore()
}
