// Forwards the app's Gemini calls through Cloudflare's egress. Exists only because
// Google's geolocation rejects the VPS's IP block — see deploy/README.md
// ("Gemini receipt scanning"). Not a general proxy: one upstream, one path
// prefix, POST only, shared secret required. Stores nothing, logs nothing.
//
// Setup: Cloudflare dashboard → Workers & Pages → Create → Start with Hello World
//   1. Edit code → paste this file → Deploy.
//   2. Settings → Variables and Secrets → add SECRET  RELAY_SECRET = `openssl rand -hex 32`
//   3. Server .env:  GEMINI_BASE_URL=https://<name>.<account>.workers.dev
//                    GEMINI_RELAY_SECRET=<same value>      then: pm2 restart bill-splitter

const UPSTREAM = 'https://generativelanguage.googleapis.com'
const PATH_PREFIX = '/v1beta/models/'
// Everything else (host, cf-*, x-forwarded-*, x-relay-secret) never reaches Google.
const FORWARD = ['content-type', 'x-goog-api-key', 'accept']

export default {
  async fetch(request, env) {
    if (!env.RELAY_SECRET) return reply(500, 'relay: RELAY_SECRET is not set')
    if (!equal(request.headers.get('x-relay-secret'), env.RELAY_SECRET)) {
      return reply(403, 'relay: bad secret')
    }
    if (request.method !== 'POST') return reply(405, 'relay: POST only')
    const url = new URL(request.url)
    if (!url.pathname.startsWith(PATH_PREFIX)) return reply(404, 'relay: unknown path')

    const headers = new Headers()
    for (const h of FORWARD) {
      const v = request.headers.get(h)
      if (v) headers.set(h, v)
    }
    // Streamed straight through; the upstream Response (status, body, content-type)
    // is returned as-is so the app sees exactly what Google sent.
    return fetch(UPSTREAM + url.pathname + url.search, {
      method: 'POST',
      headers,
      body: request.body,
    })
  },
}

// Mirrors Google's error envelope so the app's log line reads the same either way.
function reply(status, message) {
  return new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Constant-time compare so the secret can't be guessed byte-by-byte via timing.
function equal(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
