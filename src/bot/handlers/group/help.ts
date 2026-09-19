import type { MyContext } from '../../index'
import type { User } from '../../../db/schema'
import { t } from '../../../i18n'
import { startBotKeyboard } from '../../keyboards'
import { ReplyThrottle } from '../../../utils/group-throttle'

// The intro is posted on three triggers (added to the chat, START, /help), so
// it is throttled per chat rather than per trigger — pressing START twice must
// not post it twice.
const introThrottle = new ReplyThrottle(60_000)

/**
 * What the bot is and how to use it here.
 *
 * Shown to an unregistered presser with a "start the bot" button: the group is
 * where people meet the bot, but registration needs a phone, which Telegram
 * only lets us request in a private chat.
 */
export async function postGroupIntro(ctx: MyContext, opts?: { throttle?: boolean }): Promise<void> {
  if (opts?.throttle !== false && !introThrottle.take(String(ctx.chat?.id))) return

  const user = ctx.user as User | undefined
  await ctx
    .reply(t(ctx, 'group.intro', { bot: ctx.me.username }), {
      parse_mode: 'HTML',
      ...(user ? {} : { reply_markup: startBotKeyboard(ctx) }),
    })
    .catch(() => undefined)
}

/**
 * `/start@bot` in a group — what Telegram's own START button sends when someone
 * adds the bot. It must do something: silence here reads as a broken bot, and
 * this is the very first thing anyone does. The private /start is not reusable,
 * since it opens a request_contact keyboard that is invalid outside a DM.
 */
export async function groupStartHandler(ctx: MyContext): Promise<void> {
  await postGroupIntro(ctx)
}

/**
 * Group /help. Separate from the private one because the private version
 * attaches `helpKeyboard`, whose "Open App" entry is a web_app button —
 * private-chat-only, and an API error in a group.
 */
export async function groupHelpHandler(ctx: MyContext): Promise<void> {
  await ctx.reply(t(ctx, 'group.help', { bot: ctx.me.username }), {
    parse_mode: 'HTML',
  })
}
