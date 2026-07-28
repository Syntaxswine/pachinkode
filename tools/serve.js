// Minimal static server for local development. No dependencies.
//   node tools/serve.js [port]

import { createServer } from 'node:http'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'))
const PORT = +(process.argv[2] || 8790)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
}

createServer(async (req, res) => {
  try {
    // Screenshot sink. The game POSTs a canvas data-URL here and it lands on
    // disk, which is how you look at the board when the browser pane cannot
    // composite frames for a normal screenshot. From the page:
    //   fetch('/__shot?name=board', {method:'POST', body: canvas.toDataURL()})
    if (req.method === 'POST' && req.url.startsWith('/__shot')) {
      const name = new URL(req.url, 'http://x').searchParams.get('name') || 'shot'
      const chunks = []
      for await (const c of req) chunks.push(c)
      const data = Buffer.concat(chunks).toString()
      const b64 = data.slice(data.indexOf(',') + 1)
      const out = join(ROOT, 'shots', name.replace(/[^\w.-]/g, '') + '.png')
      await mkdir(join(ROOT, 'shots'), { recursive: true })
      await writeFile(out, Buffer.from(b64, 'base64'))
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(out)
      return
    }

    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    const full = normalize(join(ROOT, p))
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return }
    const s = await stat(full)
    if (s.isDirectory()) { res.writeHead(302, { Location: p + '/' }).end(); return }
    const body = await readFile(full)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    }).end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
  }
}).listen(PORT, () => console.log(`  pachinkode → http://localhost:${PORT}/`))
