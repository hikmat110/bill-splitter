// Mini App HTTP server. Runs in the same process as the bot so API routes can
// reuse the live `Bot` instance for notifications. Serves the built SPA in
// production; in dev the UI is served by Vite (which proxies /api here).

import { join, normalize } from 'node:path'
import type { Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import { config } from '../config'
import { rootLogger } from '../bot/middleware/logger'
import { handleApi } from './routes'
import { error } from './json'

const DIST = join(import.meta.dir, '../../webapp/dist')

export function startServer(bot: Bot<MyContext>) {
  const server = Bun.serve({
    port: config.PORT,
    idleTimeout: 120,
    fetch: (req) => handleRequest(req, bot),
  })
  rootLogger.info({ port: server.port }, 'Mini App server started')
  return server
}

async function handleRequest(req: Request, bot: Bot<MyContext>): Promise<Response> {
  // `req.url` is normally absolute, but some runtimes/proxies hand us a bare path
  // (e.g. "/"), which `new URL` can't parse without a base. Fall back to the Host.
  const url = new URL(req.url, `http://${req.headers.get('host') ?? 'localhost'}`)

  if (url.pathname === '/health') return new Response('ok')

  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    const start = Date.now()
    const hasAuth = (req.headers.get('authorization') ?? '').startsWith('tma ')
    try {
      const res = cors(await handleApi(req, url, bot))
      rootLogger.info(
        { method: req.method, path: url.pathname, status: res.status, hasAuth, ms: Date.now() - start },
        'API request'
      )
      return res
    } catch (e) {
      rootLogger.error(
        { err: e, method: req.method, path: url.pathname, hasAuth, ms: Date.now() - start },
        'Mini App API error'
      )
      return cors(error(500, 'Internal error'))
    }
  }

  // SPA static files — production only (dev is served by Vite).
  if (config.NODE_ENV === 'production') return serveStatic(url)
  return new Response('Not found (run the Vite dev server for the UI)', { status: 404 })
}

function cors(res: Response): Response {
  // Same-origin in prod and via the Vite proxy in dev, so CORS is normally moot;
  // these headers just make direct cross-origin calls (e.g. tunnel testing) work.
  res.headers.set('Access-Control-Allow-Origin', config.WEBAPP_URL ?? '*')
  res.headers.set('Access-Control-Allow-Headers', 'authorization, content-type')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  return res
}

async function serveStatic(url: URL): Promise<Response> {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.([/\\]|$))+/, '')
  const file = Bun.file(join(DIST, rel))
  if (url.pathname !== '/' && (await file.exists())) return new Response(file)

  // SPA fallback to index.html for client-side routes.
  const index = Bun.file(join(DIST, 'index.html'))
  if (await index.exists()) return new Response(index)
  return new Response('Web app not built — run `bun run web:build`', { status: 404 })
}
