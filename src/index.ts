// Unified entry point: boots the Mini App HTTP server and starts bot polling in
// the same process, so API routes can dispatch Telegram notifications via `bot`.

import { bot, initial } from './bot/index'
import { rootLogger } from './bot/middleware/logger'
import { config } from './config'
import { startServer } from './server/index'
import { tLang, type I18nKey } from './i18n'

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

// Command menu (the "/" button), per scope and per language. Default scope
// matches the uz i18n fallback; ru/en clients get their own descriptions.
//
// Scoping matters twice over: DM-only commands (/start opens a request_contact
// keyboard) are meaningless in a group, and the group menu is what makes
// Telegram insert the `/split@BotName` form — the only form privacy mode
// reliably delivers. The unscoped call is kept pointing at the private list, so
// if a scoped call fails the menu degrades to the previous behaviour rather
// than to an empty one.
const PRIVATE_CMDS = ['start', 'help', 'cancel'] as const
const GROUP_CMDS = ['split', 'board', 'cancel', 'help'] as const

const commandsFor = (lang: string, names: readonly string[]) =>
  names.map((command) => ({
    command,
    description: tLang(lang, `commands.${command}` as I18nKey),
  }))

const menus = [
  { scope: undefined, names: PRIVATE_CMDS },
  { scope: { type: 'all_private_chats' } as const, names: PRIVATE_CMDS },
  { scope: { type: 'all_group_chats' } as const, names: GROUP_CMDS },
]
for (const { scope, names } of menus) {
  for (const language_code of [undefined, 'ru', 'en'] as const) {
    bot.api
      .setMyCommands(commandsFor(language_code ?? 'uz', names), { scope, language_code })
      .catch((err) =>
        rootLogger.warn({ err, scope, language_code }, 'Failed to set commands')
      )
  }
}

bot.start({
  onStart: (info) => rootLogger.info({ username: info.username }, 'Bot started'),
})

export { initial }
