import type { MyContext } from '../index'
import { t } from '../../i18n'
import { helpKeyboard } from '../keyboards'

export async function helpHandler(ctx: MyContext): Promise<void> {
  await ctx.reply(t(ctx, 'help.text'), {
    parse_mode: 'HTML',
    reply_markup: helpKeyboard(ctx),
  })
}
