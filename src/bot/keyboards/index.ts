import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'

export function mainMenuKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'menu.new_bill'), 'menu:new_bill')
    .row()
    .text(t(ctx, 'menu.contacts'), 'menu:contacts')
    .row()
    .text(t(ctx, 'menu.incoming'), 'menu:incoming')
    .text(t(ctx, 'menu.history'), 'menu:history')
}
