import type { MiddlewareFn } from 'grammy'
import type { MyContext } from '../index'
import { findByTelegramId } from '../../services/user.service'
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
  return next()
}
