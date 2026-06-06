import type { MyContext } from '../index'
import { mainMenuKeyboard } from '../keyboards'
import { t } from '../../i18n'

export async function showMainMenu(ctx: MyContext): Promise<void> {
  const text = t(ctx, 'menu.title')
  const kb = mainMenuKeyboard(ctx)
  const chatId = ctx.chat?.id

  // If called from a callback query, edit that message in-place
  const cbMsgId = ctx.callbackQuery?.message?.message_id
  if (cbMsgId && chatId) {
    await ctx.api.editMessageText(chatId, cbMsgId, text, { reply_markup: kb })
      .catch(() => undefined)
    ctx.session.mainMessageId = cbMsgId
    return
  }

  // If we already have a pinned main message, edit it
  const existingId = ctx.session.mainMessageId
  if (existingId && chatId) {
    const ok = await ctx.api.editMessageText(chatId, existingId, text, { reply_markup: kb })
      .then(() => true)
      .catch(() => false)
    if (ok) return
  }

  // Send a fresh message and remember its ID
  const msg = await ctx.reply(text, { reply_markup: kb })
  if (chatId) ctx.session.mainMessageId = msg.message_id
}
