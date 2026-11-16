import type { MiddlewareFn } from 'grammy'
import type { MyContext } from '../index'
import { findByTelegramId, markSeen } from '../../services/user.service'
import { shouldTouchLastSeen } from '../../utils/last-seen'
import { t } from '../../i18n'

export const authMiddleware: MiddlewareFn<MyContext> = async (ctx, next) => {
  if (!ctx.from) return next()

  // Allow unregistered users through to /start, /help, and contact sharing —
  // /help is advertised in the command menu before registration completes.
  const isStart = ctx.message?.text?.startsWith('/start')
  const isHelp = ctx.message?.text?.startsWith('/help')
  const isContact = !!ctx.message?.contact

  const user = await findByTelegramId(BigInt(ctx.from.id))
  if (!user) {
    if (isStart || isHelp || isContact) return next()
    await ctx.reply(t(ctx, 'errors.not_registered'))
    return
  }

  ctx.user = user

  // Activity signal for the admin tab (same throttle as the Mini App API).
  // Fire-and-forget so a slow write never delays the update.
  if (shouldTouchLastSeen(user.last_seen_at, new Date())) {
    markSeen(user.id).catch((err) => ctx.logger.warn({ err }, 'last_seen bump failed'))
  }

  return next()
}
