import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { updateCardNumber, updateLanguage } from '../../services/user.service'
import { maskCard, parseCardNumber } from '../../utils/format'
import { settingsKeyboard } from '../keyboards'

export async function showSettings(ctx: MyContext): Promise<void> {
  const { card_number, language_code } = ctx.user

  const cardLine = card_number
    ? t(ctx, 'settings.card_label', { card: maskCard(card_number) })
    : t(ctx, 'settings.card_not_set')

  const text = [
    t(ctx, 'settings.title'),
    '',
    cardLine,
    t(ctx, 'settings.language_label'),
  ].join('\n')

  const kb = settingsKeyboard(ctx, language_code)
  const chatId = ctx.chat?.id
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId

  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, { reply_markup: kb })
      .catch(() => undefined)
  } else {
    await ctx.reply(text, { reply_markup: kb })
  }
}

export async function settingsCallbackHandler(ctx: MyContext, action: string, id: string): Promise<void> {
  if (action === 'set_card') {
    return startCardNumberWizard(ctx)
  }
  if (action === 'lang') {
    const lang = id as 'uz' | 'ru' | 'en'
    if (!['uz', 'ru', 'en'].includes(lang)) return
    return changeLanguage(ctx, lang)
  }
}

export async function settingsTextHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.settings_wizard
  if (!wizard || wizard.step !== 'awaiting_card_number') return

  const input = ctx.message?.text?.trim() ?? ''
  const digits = parseCardNumber(input)

  if (!digits) {
    await editSettingsMessage(ctx, t(ctx, 'settings.card_invalid'))
    return
  }

  await updateCardNumber(ctx.user.id, digits)
  ctx.user.card_number = digits
  ctx.session.settings_wizard = undefined
  await showSettings(ctx)
}

async function startCardNumberWizard(ctx: MyContext): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.settings_wizard = { step: 'awaiting_card_number', wizardMessageId: msgId }
  await editSettingsMessage(ctx, t(ctx, 'settings.card_prompt'))
}

async function changeLanguage(ctx: MyContext, lang: 'uz' | 'ru' | 'en'): Promise<void> {
  await updateLanguage(ctx.user.id, lang)
  ctx.user.language_code = lang
  await showSettings(ctx)
}

async function editSettingsMessage(ctx: MyContext, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const msgId = ctx.session.settings_wizard?.wizardMessageId ?? ctx.session.mainMessageId
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, {
      reply_markup: keyboard ?? new InlineKeyboard(),
    }).catch(() => undefined)
  }
}
