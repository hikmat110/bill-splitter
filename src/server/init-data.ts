// Pure validation of Telegram Mini App `initData` (no config/DB deps so it stays
// unit-testable). Algorithm per the Telegram "Validating data received via the
// Mini App" spec:
//
//   secret_key       = HMAC_SHA256(key="WebAppData", msg=bot_token)
//   data_check_string = sorted "key=value" lines of every field except `hash`,
//                       joined by "\n"
//   valid  <=>  HMAC_SHA256(key=secret_key, msg=data_check_string) === hash
//
// Only `hash` is removed. The newer `signature` field (Ed25519, used for the
// separate *third-party* validation method) stays IN the data-check-string for
// this bot-token HMAC check — modern clients include it, and excluding it makes
// the reconstructed string differ from what the client signed ("bad hash").

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface InitDataUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export type VerifyResult =
  | { ok: true; user: InitDataUser; authDate: Date }
  | { ok: false; reason: string }

export interface VerifyOptions {
  /** Reject initData older than this many seconds. 0 disables the check. Default 24h. */
  maxAgeSeconds?: number
  /** Override "now" (ms) — for tests. */
  now?: number
}

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: VerifyOptions = {}
): VerifyResult {
  if (!initData) return { ok: false, reason: 'empty initData' }

  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'malformed initData' }
  }

  const hash = params.get('hash')
  if (!hash) return { ok: false, reason: 'missing hash' }

  const pairs: string[] = []
  for (const [key, value] of params) {
    if (key === 'hash') continue
    pairs.push(`${key}=${value}`)
  }
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  // Constant-time compare over equal-length buffers.
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad hash' }
  }

  const authDateRaw = params.get('auth_date')
  const authDateSec = authDateRaw ? Number(authDateRaw) : NaN
  if (!Number.isFinite(authDateSec)) return { ok: false, reason: 'missing auth_date' }

  const maxAge = opts.maxAgeSeconds ?? 24 * 60 * 60
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000)
  if (maxAge > 0 && nowSec - authDateSec > maxAge) {
    return { ok: false, reason: 'stale auth_date' }
  }

  const userRaw = params.get('user')
  if (!userRaw) return { ok: false, reason: 'missing user' }
  let user: InitDataUser
  try {
    user = JSON.parse(userRaw) as InitDataUser
  } catch {
    return { ok: false, reason: 'malformed user' }
  }
  if (typeof user.id !== 'number') return { ok: false, reason: 'missing user id' }

  return { ok: true, user, authDate: new Date(authDateSec * 1000) }
}
