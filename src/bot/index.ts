import { Bot, type Context } from 'grammy'
import type { Logger } from 'pino'
import { config } from '../config'
import type { SessionContext } from './middleware/session'
import { initial, sessionMiddleware } from './middleware/session'
import { loggerMiddleware, rootLogger } from './middleware/logger'
import { startHandler, contactHandler } from './handlers/start'
import { menuCallbackHandler } from './handlers/menu'

export type MyContext = Context &
  SessionContext & {
    logger: Logger
  }

const bot = new Bot<MyContext>(config.BOT_TOKEN)

// Middleware
bot.use(loggerMiddleware)
bot.use(sessionMiddleware)

// Handlers
bot.command('start', startHandler)
bot.on('message:contact', contactHandler)

// Menu callbacks (all stubbed)
bot.callbackQuery(/^menu:/, menuCallbackHandler)

// Global error handler
bot.catch((err) => {
  const ctx = err.ctx
  ctx.logger?.error({ err: err.error }, 'Unhandled bot error')
  ctx.reply('Something went wrong. Please try again.').catch(() => undefined)
})

bot.start({
  onStart: (info) => rootLogger.info({ username: info.username }, 'Bot started'),
})

export { initial }
