import { Keyboard, InlineKeyboard, type Bot } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { showMainMenu } from './menu'
import { openAppKeyboard } from '../keyboards'
import { contactStartTelegramHandler } from './contacts'
import {
  findByTelegramId,
  upsertFromContact,
  backfillLinkedUser,
  backfillLinkedUserByTelegramId,
} from '../../services/user.service'
import { listCards } from '../../services/card.service'
import { notifyPendingBillsForNewUser } from '../../services/notification.service'

/** Deep-link param the Mini App uses to hand off to the native contact picker. */
const ADD_CONTACTS_PARAM = 'add_contacts'

export async function startHandler(ctx: MyContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id)
  const existing = await findByTelegramId(telegramId)

  if (existing) {
    // Populate ctx.user so t() picks up the stored language
    ctx.user = existing

    // `/start add_contacts` deep link from the Mini App → open the native picker.
    if (ctx.match === ADD_CONTACTS_PARAM) {
      await showMainMenu(ctx) // establishes session.mainMessageId for the wizard
      await contactStartTelegramHandler(ctx)
      return
    }

    await ctx.reply(
      t(ctx, 'start.welcome_back', { name: existing.first_name }),
      { reply_markup: { remove_keyboard: true } }
    )
    await showMainMenu(ctx)
    return
  }

  const keyboard = new Keyboard()
    .requestContact(t(ctx, 'start.share_button'))
    .resized()
    .oneTime()

  await ctx.reply(t(ctx, 'start.share_phone'), {
    reply_markup: keyboard,
  })
}

export async function contactHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const contact = ctx.message?.contact

  if (!contact || contact.user_id !== ctx.from?.id) {
    await ctx.reply(t(ctx, 'start.invalid_contact'))
    return
  }

  const from = ctx.from
  if (!from) {
    await ctx.reply(t(ctx, 'errors.generic'))
    return
  }

  // Existing users can re-share their contact (e.g. to update their phone) —
  // they shouldn't be greeted like first-timers. authMiddleware attaches
  // ctx.user when the account already exists (unregistered contact shares pass
  // through without one), so its absence marks a first registration.
  const wasRegistered = ctx.user !== undefined

  const user = await upsertFromContact(
    {
      phone_number: contact.phone_number,
      first_name: contact.first_name,
      last_name: contact.last_name,
    },
    {
      id: from.id,
      username: from.username,
      language_code: from.language_code,
    }
  )

  await backfillLinkedUser(contact.phone_number, user.id)
  await backfillLinkedUserByTelegramId(BigInt(from.id), user.id)

  ctx.user = user
  ctx.logger.info({ user_id: user.id }, 'user registered')

  await ctx.reply(
    t(ctx, 'start.registered', { name: user.first_name }),
    { reply_markup: { remove_keyboard: true } }
  )

  if (!wasRegistered) {
    await ctx.reply(t(ctx, 'start.welcome_guide'), { reply_markup: openAppKeyboard(ctx) })
  }

  // Bills sent to this person before they registered: the contact rows are now
  // linked (backfill above), but their notifications were never deliverable.
  try {
    await notifyPendingBillsForNewUser(bot, user.id)
  } catch (err) {
    ctx.logger.warn({ err }, 'pending-bill backfill notify failed')
  }

  // Onboarding: ask for a card for receiving transfers (skippable). Gated on
  // "has no cards" — contactHandler also fires when an existing user re-shares
  // their contact, and they shouldn't be re-prompted.
  const cards = await listCards(user.id)
  if (cards.length > 0) {
    await showMainMenu(ctx)
    return
  }

  const prompt = await ctx.reply(t(ctx, 'start.card_prompt'), {
    reply_markup: new InlineKeyboard().text(t(ctx, 'start.card_skip'), 'settings:card_skip:x'),
  })
  ctx.session.settings_wizard = {
    step: 'awaiting_card_number',
    wizardMessageId: prompt.message_id,
    afterRegistration: true,
  }
}
