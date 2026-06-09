// Unified entry point: boots the Mini App HTTP server and starts bot polling in
// the same process, so API routes can dispatch Telegram notifications via `bot`.

import { bot, initial } from './bot/index'
import { rootLogger } from './bot/middleware/logger'
import { config } from './config'
import { startServer } from './server/index'

startServer(bot)

// Persistent "Open App" button next to the message input (global default).
if (config.WEBAPP_URL) {
  const url = config.WEBAPP_URL
  bot.api
    .setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Bill Split', web_app: { url } },
    })
    .catch((err) => rootLogger.warn({ err }, 'Failed to set chat menu button'))
}

bot.start({
  onStart: (info) => rootLogger.info({ username: info.username }, 'Bot started'),
})

export { initial }
