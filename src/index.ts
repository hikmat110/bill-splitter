// Unified entry point: boots the Mini App HTTP server and starts bot polling in
// the same process, so API routes can dispatch Telegram notifications via `bot`.

import { bot, initial } from './bot/index'
import { rootLogger } from './bot/middleware/logger'
import { config } from './config'
import { startServer } from './server/index'
import { tLang } from './i18n'

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

// Command menu (the "/" button). Default scope matches the uz i18n fallback;
// ru/en clients get their own descriptions.
const commandsFor = (lang: string) => [
  { command: 'start', description: tLang(lang, 'commands.start') },
  { command: 'help', description: tLang(lang, 'commands.help') },
  { command: 'cancel', description: tLang(lang, 'commands.cancel') },
]
bot.api
  .setMyCommands(commandsFor('uz'))
  .catch((err) => rootLogger.warn({ err }, 'Failed to set default commands'))
for (const lang of ['ru', 'en'] as const) {
  bot.api
    .setMyCommands(commandsFor(lang), { language_code: lang })
    .catch((err) => rootLogger.warn({ err, lang }, 'Failed to set localized commands'))
}

bot.start({
  onStart: (info) => rootLogger.info({ username: info.username }, 'Bot started'),
})

export { initial }
