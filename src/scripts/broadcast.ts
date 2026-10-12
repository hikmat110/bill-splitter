// One-off announcement to every registered user, in their stored language
// (`uz` → Uzbek, `en` → English, anything else → Russian). Dry run by default:
// prints the audience split and all texts without sending.
//
//   bun run broadcast --only <telegram_id>   # send to one user (test on yourself)
//   bun run broadcast --send                 # send to everyone
//
// Re-runnable: every telegram_id delivered by --send is appended to
// logs/broadcast-<id>.sent, and a re-run skips those, so a crash or Ctrl-C
// midway never sends anyone the message twice. --only is a test send: it
// ignores the log and records nothing, so it can be repeated after edits. Talks to the Bot API only (no
// polling), so it is safe to run while the bot itself is up.

import { Bot, GrammyError, InlineKeyboard } from 'grammy'
import postgres from 'postgres'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { config } from '../config'
import { tLang } from '../i18n'
import { classifySendError } from '../utils/telegram-errors'
import { whatsNew202610 } from './announcements/whats-new-2026-10'

export interface Announcement {
  id: string
  ru: string
  uz: string
  en: string
}

type Lang = 'uz' | 'ru' | 'en'

const announcement: Announcement = whatsNew202610

// Telegram allows ~30 messages/s across chats; stay well under it.
const DELAY_MS = 60

const args = process.argv.slice(2)
const send = args.includes('--send')
const onlyIdx = args.indexOf('--only')
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined
if (onlyIdx >= 0 && !/^\d+$/.test(only ?? '')) {
  console.error('--only needs a numeric telegram_id')
  process.exit(1)
}

const pickLang = (code: string): Lang => (code === 'uz' || code === 'en' ? code : 'ru')

function keyboard(lang: Lang): InlineKeyboard | undefined {
  if (!config.WEBAPP_URL) return undefined
  return new InlineKeyboard().webApp(tLang(lang, 'menu.open_app'), config.WEBAPP_URL)
}

const sql = postgres(config.DATABASE_URL, { max: 1 })
const users = only
  ? await sql<{ telegram_id: string; language_code: string }[]>`
      SELECT telegram_id::text, language_code FROM users WHERE telegram_id = ${only}`
  : await sql<{ telegram_id: string; language_code: string }[]>`
      SELECT telegram_id::text, language_code FROM users ORDER BY created_at`
await sql.end()

mkdirSync('logs', { recursive: true })
const logPath = `logs/broadcast-${announcement.id}.sent`
const alreadySent = new Set(
  !only && existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : []
)
const pending = users.filter((u) => !alreadySent.has(u.telegram_id))
const byLang = { uz: 0, ru: 0, en: 0 }
for (const u of pending) byLang[pickLang(u.language_code)]++

console.log(`announcement: ${announcement.id}`)
console.log(`users: ${users.length}, already sent: ${users.length - pending.length}, to send: ${pending.length}`)
console.log(`  uz: ${byLang.uz}, ru: ${byLang.ru}, en: ${byLang.en} (other languages get Russian)`)
console.log(`mini app button: ${config.WEBAPP_URL ? 'yes' : 'no (WEBAPP_URL unset)'}`)

if (!send && !only) {
  console.log(`\n── ru (${announcement.ru.length} chars) ──\n${announcement.ru}`)
  console.log(`\n── uz (${announcement.uz.length} chars) ──\n${announcement.uz}`)
  console.log(`\n── en (${announcement.en.length} chars) ──\n${announcement.en}`)
  console.log('\nDry run — nothing sent. Use --only <telegram_id> to test, --send to deliver.')
  process.exit(0)
}

const bot = new Bot(config.BOT_TOKEN)
const tally = { sent: 0, blocked: 0, failed: 0 }

for (const [i, u] of pending.entries()) {
  const lang = pickLang(u.language_code)
  for (let attempt = 0; ; attempt++) {
    try {
      await bot.api.sendMessage(Number(u.telegram_id), announcement[lang], {
        parse_mode: 'HTML',
        reply_markup: keyboard(lang),
        link_preview_options: { is_disabled: true },
      })
      if (!only) appendFileSync(logPath, `${u.telegram_id}\n`)
      tally.sent++
      break
    } catch (err) {
      const code = classifySendError(err)
      if (code === 'rate_limited' && attempt < 3) {
        const wait = (err instanceof GrammyError ? err.parameters.retry_after ?? 5 : 5) * 1000
        await Bun.sleep(wait)
        continue
      }
      if (code === 'blocked' || code === 'chat_not_found') tally.blocked++
      else {
        tally.failed++
        console.error(`✗ ${u.telegram_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }
  }
  if ((i + 1) % 50 === 0) console.log(`… ${i + 1}/${pending.length}`, tally)
  await Bun.sleep(DELAY_MS)
}

console.log('done', tally)
process.exit(tally.failed > 0 ? 1 : 0)
