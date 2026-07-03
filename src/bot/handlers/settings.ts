import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { updateLanguage } from '../../services/user.service'
import {
  listCards,
  findCardById,
  addCard,
  setDefaultCard,
  renameCard,
  deleteCard,
  CardLimitError,
  MAX_CARDS_PER_USER,
} from '../../services/card.service'
import { formatCard, parseCardNumber, cardNetwork, cardDisplayLabel } from '../../utils/format'
import { settingsKeyboard, cardDetailKeyboard } from '../keyboards'
import { showMainMenu } from './menu'

export async function showSettings(ctx: MyContext): Promise<void> {
  const cards = await listCards(ctx.user.id)

  const text = [
    t(ctx, 'settings.title'),
    '',
    cards.length > 0 ? t(ctx, 'settings.cards_header') : t(ctx, 'settings.no_cards'),
    t(ctx, 'settings.language_label'),
  ].join('\n')

  const kb = settingsKeyboard(ctx, ctx.user.language_code, cards)
  const chatId = ctx.chat?.id
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId

  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, { reply_markup: kb })
      .catch(() => undefined)
  } else {
    await ctx.reply(text, { reply_markup: kb })
  }
}

async function showCardDetail(ctx: MyContext, cardId: string): Promise<void> {
  const card = await findCardById(cardId)
  if (!card || card.user_id !== ctx.user.id) {
    await showSettings(ctx)
    return
  }

  const text = [
    t(ctx, 'settings.card_title', { label: cardDisplayLabel(card) }),
    '',
    t(ctx, 'settings.card_number_line', { card: formatCard(card.number) }),
    t(ctx, 'settings.card_network', { network: cardNetwork(card.number) }),
  ].join('\n')

  await editSettingsMessage(ctx, text, cardDetailKeyboard(ctx, card))
}

export async function settingsCallbackHandler(
  ctx: MyContext,
  action: string,
  id: string
): Promise<void> {
  if (action === 'card') return showCardDetail(ctx, id)
  if (action === 'card_add') return startCardNumberWizard(ctx)
  if (action === 'card_default') {
    await setDefaultCard(ctx.user.id, id)
    return showSettings(ctx)
  }
  if (action === 'card_rename') return startCardRenameWizard(ctx, id)
  if (action === 'card_del') {
    await deleteCard(ctx.user.id, id)
    return showSettings(ctx)
  }
  if (action === 'card_skip') return skipRegistrationCard(ctx)
  if (action === 'lang') {
    const lang = id as 'uz' | 'ru' | 'en'
    if (!['uz', 'ru', 'en'].includes(lang)) return
    return changeLanguage(ctx, lang)
  }
}

export async function settingsTextHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.settings_wizard
  if (!wizard) return
  const input = ctx.message?.text?.trim() ?? ''

  if (wizard.step === 'awaiting_card_number') {
    const digits = parseCardNumber(input)
    if (!digits) {
      // During registration onboarding the Skip button must survive a typo —
      // without it the user would be stuck on this step (short of /cancel).
      await editSettingsMessage(
        ctx,
        t(ctx, 'settings.card_invalid'),
        wizard.afterRegistration ? registrationSkipKeyboard(ctx) : undefined
      )
      return
    }

    try {
      await addCard(ctx.user.id, digits)
    } catch (e) {
      if (e instanceof CardLimitError) {
        await editSettingsMessage(
          ctx,
          t(ctx, 'settings.card_limit', { max: String(MAX_CARDS_PER_USER) })
        )
        ctx.session.settings_wizard = undefined
        return
      }
      throw e
    }

    if (wizard.afterRegistration) {
      // Edit the prompt while the wizard still anchors it, then hand over to
      // the main menu (which creates its own pinned message).
      await editSettingsMessage(ctx, t(ctx, 'start.card_saved'))
      ctx.session.settings_wizard = undefined
      await showMainMenu(ctx)
    } else {
      ctx.session.settings_wizard = undefined
      await showSettings(ctx)
    }
    return
  }

  if (wizard.step === 'awaiting_card_label' && wizard.editingCardId) {
    if (input.length < 1 || input.length > 50) {
      await editSettingsMessage(ctx, t(ctx, 'settings.rename_prompt'))
      return
    }
    const cardId = wizard.editingCardId
    await renameCard(ctx.user.id, cardId, input)
    // Render first — editSettingsMessage anchors on the wizard's message id.
    await showCardDetail(ctx, cardId)
    ctx.session.settings_wizard = undefined
  }
}

/** Registration onboarding: user tapped Skip on the card prompt. */
async function skipRegistrationCard(ctx: MyContext): Promise<void> {
  // No-op-safe on double-tap: the wizard may already be cleared.
  ctx.session.settings_wizard = undefined
  const msgId = ctx.callbackQuery?.message?.message_id
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api
      .editMessageText(chatId, msgId, t(ctx, 'start.card_skipped'))
      .catch(() => undefined)
  }
  await showMainMenu(ctx)
}

function registrationSkipKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'start.card_skip'), 'settings:card_skip:x')
}

async function startCardNumberWizard(ctx: MyContext): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.settings_wizard = { step: 'awaiting_card_number', wizardMessageId: msgId }
  await editSettingsMessage(ctx, t(ctx, 'settings.card_prompt'))
}

async function startCardRenameWizard(ctx: MyContext, cardId: string): Promise<void> {
  const card = await findCardById(cardId)
  if (!card || card.user_id !== ctx.user.id) return showSettings(ctx)
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.settings_wizard = {
    step: 'awaiting_card_label',
    wizardMessageId: msgId,
    editingCardId: cardId,
  }
  await editSettingsMessage(ctx, t(ctx, 'settings.rename_prompt'))
}

async function changeLanguage(ctx: MyContext, lang: 'uz' | 'ru' | 'en'): Promise<void> {
  await updateLanguage(ctx.user.id, lang)
  ctx.user.language_code = lang
  await showSettings(ctx)
}

async function editSettingsMessage(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const msgId = ctx.session.settings_wizard?.wizardMessageId ?? ctx.session.mainMessageId
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, {
      reply_markup: keyboard ?? new InlineKeyboard(),
    }).catch(() => undefined)
  }
}
