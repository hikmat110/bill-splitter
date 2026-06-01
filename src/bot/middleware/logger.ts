import pino from 'pino'
import type { MiddlewareFn } from 'grammy'
import type { MyContext } from '../index'
import { config } from '../../config'

export const rootLogger = pino(
  { level: config.LOG_LEVEL },
  config.NODE_ENV === 'development'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined
)

export const loggerMiddleware: MiddlewareFn<MyContext> = (ctx, next) => {
  ctx.logger = rootLogger.child({
    telegram_id: ctx.from?.id,
    chat_id: ctx.chat?.id,
    update_id: ctx.update.update_id,
  })
  return next()
}
