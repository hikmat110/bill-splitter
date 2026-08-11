// Mini App HTTP server. Runs in the same process as the bot so API routes can
// reuse the live `Bot` instance for notifications. Serves the built SPA in
// production; in dev the UI is served by Vite (which proxies /api here).

import { join, normalize } from 'node:path'
import type { Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import { config } from '../config'
import { rootLogger } from '../bot/middleware/logger'
import { handleApi } from './routes'
import { error, json } from './json'
import { SERVER_BUILD, cacheControlFor, readWebappBuild } from './version'

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

  // Also the freshness oracle for the Mini App's stale-bundle check, hence
  // `no-store`: a cached /health (a proxy, or Cloudflare in front of the origin)
  // would silently disable it. `webapp` is the build on disk — see ./version.
  if (url.pathname === '/health') {
    return json(
      { status: 'ok', server: SERVER_BUILD, webapp: await readWebappBuild(DIST) },
      { headers: { 'cache-control': 'no-store' } }
    )
  }

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
  if (url.pathname !== '/' && (await file.exists())) {
    return new Response(file, { headers: { 'cache-control': cacheControlFor(url.pathname) } })
  }

  // A hashed asset that isn't on disk belongs to a build that no longer exists
  // (every build wipes dist). 404 it rather than falling through: answering a
  // module-script request with index.html fails on MIME type, which is a white
  // screen instead of a clean error. Assets are never client-side routes — the
  // app has no router at all.
  if (url.pathname.startsWith('/assets/')) return new Response('Not found', { status: 404 })

  // SPA fallback to index.html for client-side routes.
  const index = Bun.file(join(DIST, 'index.html'))
  if (await index.exists()) {
    return new Response(index, { headers: { 'cache-control': 'no-cache' } })
  }
  return new Response('Web app not built — run `bun run web:build`', { status: 404 })
}
