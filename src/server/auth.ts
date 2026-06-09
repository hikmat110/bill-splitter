// Request authentication for the Mini App API. Wraps the pure `verifyInitData`
// with config (bot token) and user resolution against the DB.

import { config } from '../config'
import { findByTelegramId } from '../services/user.service'
import type { User } from '../db/schema'
import { error } from './json'
import { verifyInitData } from './init-data'
import { rootLogger } from '../bot/middleware/logger'

/** Pull the raw initData string from `Authorization: tma <initData>`. */
export function extractInitData(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth && auth.startsWith('tma ')) return auth.slice(4)
  return null
}

export type AuthOutcome = { user: User } | { response: Response }

/**
 * Authenticate a request. Returns the resolved registered `User`, or a ready-to-send
 * 401 `Response`. Registration stays a bot-only flow, so an unregistered (but validly
 * authenticated) Telegram user is rejected.
 */
export async function authenticate(req: Request): Promise<AuthOutcome> {
  const initData = extractInitData(req)
  if (!initData) {
    rootLogger.warn({ authReason: 'missing initData' }, 'Mini App auth rejected')
    return { response: error(401, 'Missing initData') }
  }

  const result = verifyInitData(initData, config.BOT_TOKEN)
  if (!result.ok) {
    rootLogger.warn({ authReason: 'invalid initData', detail: result.reason }, 'Mini App auth rejected')
    return { response: error(401, `Invalid initData: ${result.reason}`) }
  }

  const user = await findByTelegramId(BigInt(result.user.id))
  if (!user) {
    rootLogger.warn(
      { authReason: 'user not registered', telegramId: result.user.id },
      'Mini App auth rejected'
    )
    return { response: error(401, 'User not registered — open the bot first') }
  }

  return { user }
}
