/**
 * The Node listener.
 *
 * The build emits a Worker-shaped module — `{ fetch, queue, email, scheduled }`
 * — because that is what Cloudflare loads and what the whole codebase is
 * written against. On a plain server something has to open a socket and turn
 * Node's streams into `Request`/`Response`, and that is all this file does.
 *
 * It is deliberately not a framework. Two behaviours matter and both are here:
 * prerendered HTML and hashed assets are served from disk without touching the
 * application (a marketing page must not cost a render), and everything else
 * goes to the same `fetch` the Worker runtime would have called. Keeping it to
 * one file with no dependencies is what makes "the Node target runs the same
 * code" checkable by reading rather than by trusting.
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve as resolvePath, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = join(ROOT, '.output', 'client')
const SERVER = join(ROOT, '.output', 'server', 'server.js')

const PORT = Number(process.env.PORT ?? 8917)
const HOST = process.env.HOST ?? '127.0.0.1'

if (!existsSync(SERVER)) {
  console.error(`[mailysend] no build at ${SERVER}. Run: pnpm build:node`)
  process.exit(1)
}

const app = (await import(SERVER)).default

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Resolves a URL path to a file inside `.output/client`, or null.
 *
 * The `startsWith` check is the security boundary: a path is normalised first
 * and then required to still live under the client directory, so `%2e%2e/` and
 * friends cannot walk out of it. Directories resolve to their `index.html`,
 * which is how the prerendered pages are addressed.
 */
function staticFile(pathname) {
  const decoded = decodeURIComponent(pathname)
  if (decoded.includes('\0')) return null
  const candidate = resolvePath(join(CLIENT, normalize(decoded)))
  if (candidate !== CLIENT && !candidate.startsWith(CLIENT + sep)) return null

  if (existsSync(candidate)) {
    const stat = statSync(candidate)
    if (stat.isFile()) return { path: candidate, size: stat.size, mtime: stat.mtimeMs }
    const index = join(candidate, 'index.html')
    if (existsSync(index)) {
      const indexStat = statSync(index)
      return { path: index, size: indexStat.size, mtime: indexStat.mtimeMs }
    }
    return null
  }

  // `/docs` → `.output/client/docs/index.html`, the shape the prerenderer writes.
  const asIndex = `${candidate}${sep}index.html`
  if (existsSync(asIndex)) {
    const stat = statSync(asIndex)
    return { path: asIndex, size: stat.size, mtime: stat.mtimeMs }
  }
  return null
}

/**
 * Hashed filenames are immutable; everything else is revalidated.
 *
 * Vite puts a content hash in every asset name under `/assets`, so those can be
 * cached for a year — a new build produces new names. An HTML document must
 * not be, or a deploy would be invisible to anyone who had already visited.
 */
const cacheControl = (path) =>
  path.includes(`${sep}assets${sep}`) || /\.[0-9a-zA-Z_-]{8,}\.\w+$/.test(path)
    ? 'public, max-age=31536000, immutable'
    : path.endsWith('.html')
      ? 'public, max-age=0, must-revalidate'
      : 'public, max-age=3600'

function serveStatic(file, req, res) {
  const etag = `W/"${file.size}-${Math.round(file.mtime)}"`
  const headers = {
    'content-type': MIME[extname(file.path)] ?? 'application/octet-stream',
    'content-length': String(file.size),
    'cache-control': cacheControl(file.path),
    etag,
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': headers['cache-control'] })
    res.end()
    return
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file.path).pipe(res)
}

/** Node's request as a `Request`, with the body still a stream. */
function toRequest(req, origin) {
  const url = new URL(req.url ?? '/', origin)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
  })
}

const server = createServer(async (req, res) => {
  try {
    // Behind nginx or Cloudflare the origin is not what the socket says it is.
    // Every absolute URL the app mints — tracking pixels, unsubscribe links,
    // canonical tags — is built from this, so getting it wrong is not cosmetic.
    // An empty header counts as absent: a proxy that sets the name but not the
    // value would otherwise produce the origin `://host`, and every absolute
    // URL built from it would be broken in a way that only shows up in mail.
    const first = (value, fallback) => {
      const head = String(value ?? '')
        .split(',')[0]
        .trim()
      return head || fallback
    }
    const proto = first(req.headers['x-forwarded-proto'], 'http')
    const host = first(req.headers['x-forwarded-host'], first(req.headers.host, `${HOST}:${PORT}`))
    const origin = `${proto}://${host}`

    const pathname = new URL(req.url ?? '/', origin).pathname
    if (req.method === 'GET' || req.method === 'HEAD') {
      const file = staticFile(pathname)
      if (file) return serveStatic(file, req, res)
    }

    const response = await app.fetch(toRequest(req, origin))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (!response.body) return res.end()
    await Readable.fromWeb(response.body).pipe(res)
  } catch (err) {
    console.error('[mailysend] request failed', err)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end('{"message":"Internal server error","name":"internal_server_error"}')
  }
})

// nginx caps the body at 200M; there is no reason for this to time out first.
server.requestTimeout = 300_000
server.headersTimeout = 65_000
server.keepAliveTimeout = 61_000

server.listen(PORT, HOST, () => {
  console.log(`[mailysend] listening on http://${HOST}:${PORT}`)
})

/**
 * PM2 sends SIGINT and then SIGKILL after `kill_timeout`. Draining in between
 * lets in-flight sends finish; a hard kill is survivable (leases expire) but
 * costs a retry.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[mailysend] ${signal}: draining`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
}
