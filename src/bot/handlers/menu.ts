import type { MyContext } from '../index'
import { mainMenuKeyboard } from '../keyboards'
import { t } from '../../i18n'

export async function showMainMenu(ctx: MyContext): Promise<void> {
  await ctx.reply(t(ctx, 'menu.title'), {
    reply_markup: mainMenuKeyboard(ctx),
  })
}

export async function menuCallbackHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery()
  await ctx.reply(t(ctx, 'menu.coming_soon'))
}
