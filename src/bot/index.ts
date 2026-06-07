import { Bot, type Context } from 'grammy'
import type { Logger } from 'pino'
import { config } from '../config'
import type { SessionContext } from './middleware/session'
import { initial, sessionMiddleware } from './middleware/session'
import { loggerMiddleware } from './middleware/logger'
import { authMiddleware } from './middleware/auth'
import { startHandler, contactHandler } from './handlers/start'
import { showMainMenu } from './handlers/menu'
import {
  contactsMenuHandler,
  contactAddStartHandler,
  contactStartManualHandler,
  contactStartTelegramHandler,
  contactStartUsernameHandler,
  contactShareHandler,
  contactTextHandler,
  contactViewHandler,
  contactDeleteHandler,
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
} from './handlers/incoming'
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
bot.use(authMiddleware)

// ─── Commands ────────────────────────────────────────────────────────────────

bot.command('start', startHandler)

bot.command('cancel', async (ctx) => {
  ctx.session.bill_wizard = undefined
  ctx.session.contact_wizard = undefined
  ctx.session.dispute_wizard = undefined
  ctx.session.settings_wizard = undefined
  await showMainMenu(ctx)
})

// Route contact shares: registration vs. contacts import wizard
bot.on('message:contact', async (ctx) => {
  if (ctx.session.contact_wizard?.step === 'awaiting_contact_share') {
    return contactShareHandler(ctx)
  }
  return contactHandler(ctx)
})

// ─── Text message dispatcher ─────────────────────────────────────────────────

bot.on('message:text', async (ctx) => {
  if (ctx.session.contact_wizard) return contactTextHandler(ctx)
  if (ctx.session.bill_wizard) return billTextHandler(ctx)
  if (ctx.session.dispute_wizard) return disputeReasonHandler(ctx, bot)
  if (ctx.session.settings_wizard) return settingsTextHandler(ctx)
})

// ─── Menu callbacks ───────────────────────────────────────────────────────────

bot.callbackQuery('menu:contacts', async (ctx) => {
  await ctx.answerCallbackQuery()
  await contactsMenuHandler(ctx)
})

bot.callbackQuery('menu:back', async (ctx) => {
  await ctx.answerCallbackQuery()
  await showMainMenu(ctx)
})

bot.callbackQuery('menu:new_bill', async (ctx) => {
  await ctx.answerCallbackQuery()
  await newBillStartHandler(ctx)
})

bot.callbackQuery('menu:incoming', async (ctx) => {
  await ctx.answerCallbackQuery()
  await incomingHandler(ctx)
})

bot.callbackQuery('menu:history', async (ctx) => {
  await ctx.answerCallbackQuery()
  await historyHandler(ctx)
})

bot.callbackQuery('menu:settings', async (ctx) => {
  await ctx.answerCallbackQuery()
  await showSettings(ctx)
})

// ─── Bill callbacks ───────────────────────────────────────────────────────────

bot.callbackQuery(/^bill:/, async (ctx) => {
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

bot.callbackQuery(/^contact:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const { action, id } = decode(ctx.callbackQuery.data)
  if (action === 'view') return contactViewHandler(ctx, id)
  if (action === 'delete') return contactDeleteHandler(ctx, id)
  if (action === 'add') return contactAddStartHandler(ctx)
  if (action === 'add_manual') return contactStartManualHandler(ctx)
  if (action === 'add_telegram') return contactStartTelegramHandler(ctx)
  if (action === 'add_username') return contactStartUsernameHandler(ctx)
  if (action === 'list') return contactsMenuHandler(ctx)
  if (action === 'skip_phone') return contactSkipPhoneHandler(ctx)
  if (action === 'cancel') return contactCancelHandler(ctx)
})

// ─── Incoming callbacks ───────────────────────────────────────────────────────

bot.callbackQuery(/^incoming:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const { action, id } = decode(ctx.callbackQuery.data)
  if (action === 'view') return incomingDetailHandler(ctx, id)
})

// ─── History callbacks ────────────────────────────────────────────────────────

bot.callbackQuery(/^history:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const { action, id } = decode(ctx.callbackQuery.data)
  if (action === 'tab') return historyTabHandler(ctx, id)
  if (action === 'detail') return historyDetailHandler(ctx, id)
})

// ─── Settings callbacks ───────────────────────────────────────────────────────

bot.callbackQuery(/^settings:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const data = ctx.callbackQuery.data
  const parts = data.split(':')
  const action = parts[1] ?? ''
  const id = parts[2] ?? ''
  return settingsCallbackHandler(ctx, action, id)
})

// ─── Global error handler ────────────────────────────────────────────────────

bot.catch((err) => {
  const ctx = err.ctx
  ctx.logger?.error({ err: err.error }, 'Unhandled bot error')
  ctx.reply('Something went wrong. Please try again.').catch(() => undefined)
})

// Polling is started by the unified entry point (src/index.ts), which also boots
// the Mini App HTTP server in the same process so notifications can reuse `bot`.
export { bot, initial }
