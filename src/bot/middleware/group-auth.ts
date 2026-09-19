import type { MiddlewareFn } from 'grammy'
import type { MyContext } from '../index'
import { findByTelegramId, markSeen } from '../../services/user.service'
import { shouldTouchLastSeen } from '../../utils/last-seen'
import { isAnonymousSender } from '../../utils/chat-scope'

/**
 * Group counterpart of authMiddleware. Two deliberate differences:
 *
 *  1. It NEVER replies. The private middleware answers unregistered users with
 *     "please /start", which in a group means one public message per stranger
 *     per message — the bug this whole group effort starts from. Here an
 *     unregistered sender simply arrives with `ctx.user` unset, and each group
 *     handler decides whether that matters.
 *  2. It drops senders with no usable identity (other bots, anonymous admins,
 *     channel senders). They cannot be DM'd, so they can never be a contact or
 *     a bill participant; letting them through would only produce rows keyed on
 *     a meaningless telegram id.
 *
 * Because `ctx.user` may be unset here, group handlers must read it as
 * `ctx.user as User | undefined` — MyContext deliberately keeps it non-optional
 * so the ~40 private-handler call sites stay untouched.
 */
export const groupAuthMiddleware: MiddlewareFn<MyContext> = async (ctx, next) => {
  if (isAnonymousSender({ from: ctx.from, senderChat: ctx.senderChat })) return

  const user = await findByTelegramId(BigInt(ctx.from!.id))
  if (!user) return next()

  ctx.user = user

  // Same fire-and-forget activity signal as the private path (middleware/auth).
  if (shouldTouchLastSeen(user.last_seen_at, new Date())) {
    markSeen(user.id).catch((err) => ctx.logger.warn({ err }, 'last_seen bump failed'))
  }

  return next()
}
