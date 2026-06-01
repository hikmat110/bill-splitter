import type { MiddlewareFn } from 'grammy'
import type { MyContext } from '../index'
import { findByTelegramId } from '../../services/user.service'
import { t } from '../../i18n'

export const authMiddleware: MiddlewareFn<MyContext> = async (ctx, next) => {
  if (!ctx.from) return next()

  // Allow unregistered users through to /start and contact sharing
  const isStart = ctx.message?.text?.startsWith('/start')
  const isContact = !!ctx.message?.contact

  const user = await findByTelegramId(BigInt(ctx.from.id))
  if (!user) {
    if (isStart || isContact) return next()
    await ctx.reply(t(ctx, 'errors.not_registered'))
    return
  }

  ctx.user = user
  return next()
}
