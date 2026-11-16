import { Bot, type Context } from 'grammy'
import type { Logger } from 'pino'
import { config } from '../config'
import type { SessionContext } from './middleware/session'
import { initial, sessionMiddleware } from './middleware/session'
import { loggerMiddleware } from './middleware/logger'
import { authMiddleware } from './middleware/auth'
import { groupAuthMiddleware } from './middleware/group-auth'
import { startHandler, contactHandler } from './handlers/start'
import { helpHandler } from './handlers/help'
import { showMainMenu } from './handlers/menu'
import {
  contactsMenuHandler,
  contactAddStartHandler,
  contactStartManualHandler,
  contactStartTelegramHandler,
  contactStartUsernameHandler,
  usersSharedHandler,
  contactTextHandler,
  contactViewHandler,
  contactDeleteHandler,
  contactForceDeleteHandler,
  contactSkipPhoneHandler,
  contactCancelHandler,
} from './handlers/contacts'
import {
  newBillStartHandler,
  billTextHandler,
  billCallbackHandler,
} from './handlers/new-bill'
import {
  incomingHandler,
  incomingDetailHandler,
  markPaidCallbackHandler,
  markPaidSkipHandler,
} from './handlers/incoming'
import { photoHandler } from './handlers/photo'
import { supportTextHandler } from './handlers/support'
import { groupHelpHandler, groupStartHandler } from './handlers/group/help'
import {
  splitStartHandler,
  boardCommandHandler,
  splitCancelCommandHandler,
  groupCallbackHandler,
} from './handlers/group/split'
import { groupPhotoHandler } from './handlers/group/receipt'
import { botMembershipHandler } from './handlers/group/membership'
import {
  historyHandler,
  historyTabHandler,
  historyDetailHandler,
  remindHandler,
} from './handlers/history'
import {
  confirmPaymentHandler,
  disputeStartHandler,
  disputeReasonHandler,
} from './handlers/payment'
import {
  showSettings,
  settingsCallbackHandler,
  settingsTextHandler,
} from './handlers/settings'
import type { User } from '../db/schema'
import { decode } from '../utils/callback'
import { isBotCommandMessage } from '../utils/chat-scope'
import { t } from '../i18n'

export type MyContext = Context &
  SessionContext & {
    logger: Logger
    user: User
  }

const bot = new Bot<MyContext>(config.BOT_TOKEN)

// Middleware stack
bot.use(loggerMiddleware)
bot.use(sessionMiddleware)

// ─── Chat-type boundary ──────────────────────────────────────────────────────
// Nothing is registered on `bot` itself below this point. Channels, channel
// posts and updates without a chat therefore reach zero handlers: the bot is
// silent there by construction rather than by an if-statement, and a future
// `bot.on('message:text')` cannot re-open the group firehose by accident.
//
// `priv` is the bot as it has always been — same middleware order, same
// handlers, same session key. `group` is a small, explicit, closed set.
const priv = bot.chatType('private')
const group = bot.chatType(['group', 'supergroup'])

priv.use(authMiddleware)

// Registered BEFORE groupAuthMiddleware on purpose: that middleware drops
// senders with no personal identity, and an anonymous admin adding or kicking
// the bot is exactly such a sender. Membership events must survive it.
group.on('my_chat_member', botMembershipHandler)

group.use(groupAuthMiddleware)

// ─── Commands ────────────────────────────────────────────────────────────────

priv.command('start', startHandler)

priv.command('help', helpHandler)

priv.command('cancel', async (ctx) => {
  ctx.session.bill_wizard = undefined
  ctx.session.contact_wizard = undefined
  ctx.session.dispute_wizard = undefined
  ctx.session.settings_wizard = undefined
  ctx.session.mark_paid_wizard = undefined
  await showMainMenu(ctx)
})

// Contact shares are only used for phone-based registration
priv.on('message:contact', (ctx) => contactHandler(ctx, bot))

// Multi-select picker results (request_users) → batch-add contacts
priv.on('message:users_shared', usersSharedHandler)

// Receipt/proof photos — only acted on while a relevant wizard is awaiting one.
priv.on('message:photo', (ctx) => photoHandler(ctx, bot))

// ─── Text message dispatcher ─────────────────────────────────────────────────

priv.on('message:text', async (ctx) => {
  if (ctx.session.contact_wizard) return contactTextHandler(ctx)
  if (ctx.session.bill_wizard) return billTextHandler(ctx)
  if (ctx.session.dispute_wizard) return disputeReasonHandler(ctx, bot)
  if (ctx.session.settings_wizard) return settingsTextHandler(ctx)
  // Nothing is expecting this text → it is a message to support. This branch
  // must stay last: any wizard added later has to be checked above it, or its
  // input gets filed as a support message.
  return supportTextHandler(ctx, bot)
})

// ─── Menu callbacks ───────────────────────────────────────────────────────────

priv.callbackQuery('menu:contacts', async (ctx) => {
  await ctx.answerCallbackQuery()
  await contactsMenuHandler(ctx)
})

priv.callbackQuery('menu:back', async (ctx) => {
  await ctx.answerCallbackQuery()
  await showMainMenu(ctx)
})

priv.callbackQuery('menu:new_bill', async (ctx) => {
  await ctx.answerCallbackQuery()
  await newBillStartHandler(ctx)
})

priv.callbackQuery('menu:incoming', async (ctx) => {
  await ctx.answerCallbackQuery()
  await incomingHandler(ctx)
})

priv.callbackQuery('menu:history', async (ctx) => {
  await ctx.answerCallbackQuery()
  await historyHandler(ctx)
})

priv.callbackQuery('menu:settings', async (ctx) => {
  await ctx.answerCallbackQuery()
  await showSettings(ctx)
})

// ─── Bill callbacks ───────────────────────────────────────────────────────────

priv.callbackQuery(/^bill:/, async (ctx) => {
  const data = ctx.callbackQuery.data
  const parts = data.split(':')
  const action = parts[1] ?? ''
  const id = parts.slice(2).join(':')

  // Payment actions (confirm/dispute/remind) need answerCallbackQuery AFTER
  // potentially long async work; handle them separately
  if (action === 'mark_paid') {
    await ctx.answerCallbackQuery()
    return markPaidCallbackHandler(ctx, id, bot)
  }
  if (action === 'mps') {
    await ctx.answerCallbackQuery()
    return markPaidSkipHandler(ctx, id, bot)
  }
  if (action === 'confirm') {
    await ctx.answerCallbackQuery()
    return confirmPaymentHandler(ctx, id, bot)
  }
  if (action === 'dispute') {
    await ctx.answerCallbackQuery()
    return disputeStartHandler(ctx, id)
  }
  if (action === 'remind') {
    // remindHandler calls answerCallbackQuery with a message itself
    return remindHandler(ctx, id, bot)
  }

  await ctx.answerCallbackQuery()
  return billCallbackHandler(ctx, action, id, bot)
})

// ─── Contact callbacks ────────────────────────────────────────────────────────

priv.callbackQuery(/^contact:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const { action, id } = decode(ctx.callbackQuery.data)
  if (action === 'view') return contactViewHandler(ctx, id)
  if (action === 'delete') return contactDeleteHandler(ctx, id)
  if (action === 'forcedel') return contactForceDeleteHandler(ctx, id)
  if (action === 'add') return contactAddStartHandler(ctx)
  if (action === 'add_manual') return contactStartManualHandler(ctx)
  if (action === 'add_telegram') return contactStartTelegramHandler(ctx)
  if (action === 'add_username') return contactStartUsernameHandler(ctx)
  if (action === 'list') return contactsMenuHandler(ctx)
  if (action === 'skip_phone') return contactSkipPhoneHandler(ctx)
  if (action === 'cancel') return contactCancelHandler(ctx)
})

// ─── Incoming callbacks ───────────────────────────────────────────────────────

priv.callbackQuery(/^incoming:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const { action, id } = decode(ctx.callbackQuery.data)
  if (action === 'view') return incomingDetailHandler(ctx, id)
})

// ─── History callbacks ────────────────────────────────────────────────────────

priv.callbackQuery(/^history:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const { action, id } = decode(ctx.callbackQuery.data)
  if (action === 'tab') return historyTabHandler(ctx, id)
  if (action === 'detail') return historyDetailHandler(ctx, id)
})

// ─── Settings callbacks ───────────────────────────────────────────────────────

priv.callbackQuery(/^settings:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const data = ctx.callbackQuery.data
  const parts = data.split(':')
  const action = parts[1] ?? ''
  const id = parts[2] ?? ''
  return settingsCallbackHandler(ctx, action, id)
})

// ─── Group handlers ───────────────────────────────────────────────────────────
// Deliberately tiny. There is no `message:text` handler here and there never
// should be: in a private chat unrouted text becomes a support ticket, which in
// a group would file every ordinary conversation as one.

// Telegram's own START button sends `/start@bot` into the group, so this must
// answer — it is the first thing anyone does after adding the bot.
group.command('start', groupStartHandler)
group.command('help', groupHelpHandler)
group.command('split', (ctx) => splitStartHandler(ctx, bot))
group.command('board', (ctx) => boardCommandHandler(ctx, bot))
group.command('cancel', (ctx) => splitCancelCommandHandler(ctx, bot))

// Only ever acted on when it replies to this split's own card — see the gate in
// handlers/group/receipt. Every other group photo is somebody's lunch.
group.on('message:photo', (ctx) => groupPhotoHandler(ctx, bot))

group.callbackQuery(/^g:/, async (ctx) => {
  const { action, id } = decode(ctx.callbackQuery.data)
  // Group handlers answer the callback themselves: several of them attach a
  // deep link to the answer, which must be set on the single allowed reply.
  return groupCallbackHandler(ctx, action, id, bot)
})

// ─── Global error handler ────────────────────────────────────────────────────

bot.catch((err) => {
  const ctx = err.ctx
  ctx.logger?.error({ err: err.error }, 'Unhandled bot error')

  // A callback answer is visible only to the person who pressed the button, so
  // it is safe in any chat type.
  if (ctx.callbackQuery) {
    ctx
      .answerCallbackQuery({ text: t(ctx, 'errors.generic') })
      .catch(() => undefined)
    return
  }

  // A private chat always gets an answer. In a group, only a COMMAND does: it
  // was explicitly addressed to the bot, so an error reply is a direct answer
  // rather than noise — and without it a broken /split is indistinguishable
  // from a /split nobody wired up. Everything else stays silent, because a
  // burst of errors there would be a burst of public messages.
  if (ctx.chat?.type === 'private' || isBotCommandMessage(ctx.message)) {
    ctx.reply(t(ctx, 'errors.generic')).catch(() => undefined)
  }
})

// Polling is started by the unified entry point (src/index.ts), which also boots
// the Mini App HTTP server in the same process so notifications can reuse `bot`.
export { bot, initial }
