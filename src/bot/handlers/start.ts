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
  activateGroupSplitMembersByTelegramId,
} from '../../services/user.service'
import { listCards } from '../../services/card.service'
import { notifyPendingBillsForNewUser } from '../../services/notification.service'
import { parseStartPayload, type DeepLink } from '../../utils/deep-link'
import { splitAppUrl } from '../keyboards'
import { findSplitById } from '../../services/group-split.service'

/**
 * Act on a /start deep-link payload for a user who is definitely registered.
 * Returns true when it handled the update, so the caller skips the usual
 * welcome-back + main menu.
 */
async function applyDeepLink(ctx: MyContext, link: DeepLink): Promise<boolean> {
  if (link.kind === 'add_contacts') {
    await showMainMenu(ctx) // establishes session.mainMessageId for the wizard
    await contactStartTelegramHandler(ctx)
    return true
  }

  if (link.kind === 'group_split') {
    // Arrived from a group Join card. Their roster entry and contact were
    // linked by the registration backfill; all that is left is a way back.
    const split = await findSplitById(link.splitId)
    if (!split) return false
    await ctx.reply(t(ctx, 'start.group_split_ready'), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().url(
        t(ctx, 'group.btn.open'),
        splitAppUrl(ctx, split.id)
      ),
    })
    return true
  }

  return false
}

export async function startHandler(ctx: MyContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id)
  const existing = await findByTelegramId(telegramId)
  // Parsed for everyone, registered or not. Anything unrecognised is `none` and
  // is never echoed back.
  const link = parseStartPayload(ctx.match?.toString())

  if (existing) {
    // Populate ctx.user so t() picks up the stored language
    ctx.user = existing

    if (await applyDeepLink(ctx, link)) return

    await ctx.reply(
      t(ctx, 'start.welcome_back', { name: existing.first_name }),
      { reply_markup: { remove_keyboard: true } }
    )
    await showMainMenu(ctx)
    return
  }

  // A brand-new user arriving through a deep link is the whole point of the
  // group→DM handoff, and this branch used to drop the payload on the floor.
  // Stash it so it can be replayed once they finish sharing their phone.
  if (link.kind !== 'none') ctx.session.pending_start_link = link

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
  // Group splits they joined before having an account. Unconditional, so
  // linking never depends on the in-memory session or on how they arrived — a
  // deploy between /start and the phone share must not cost them their place.
  await activateGroupSplitMembersByTelegramId(BigInt(from.id), user.id)

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

  // Replay the deep link they arrived with, now that they have an account.
  // Must run BEFORE the card prompt below, which claims settings_wizard.
  const pending = ctx.session.pending_start_link
  ctx.session.pending_start_link = undefined
  if (pending && pending.kind !== 'none') {
    await applyDeepLink(ctx, pending).catch((err) =>
      ctx.logger.warn({ err }, 'deep-link replay failed')
    )
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
