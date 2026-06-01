import { InlineKeyboard, type Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import {
  getBillWithDetails,
  getParticipantById,
  saveNotificationMessageId,
  remindParticipant,
} from './bill.service'
import { findById } from './user.service'
import { formatMoney } from '../utils/format'
import { t } from '../i18n'
import type { Context } from 'grammy'

// Minimal context shim for t() when no real bot context is available
function langCtx(lang: string): Context {
  return { from: { language_code: lang } } as unknown as Context
}

export async function sendBillNotifications(
  bot: Bot<MyContext>,
  billId: string
): Promise<void> {
  const details = await getBillWithDetails(billId)
  if (!details) return

  for (const participant of details.participants) {
    if (!participant.contact.linked_user_id) continue

    const participantUser = await findById(participant.contact.linked_user_id)
    if (!participantUser) continue

    const ctx = langCtx(participantUser.language_code)
    const text = t(ctx, 'payment.notification_message', {
      title: details.bill.title,
      amount: formatMoney(participant.amount),
      creator: details.creator.first_name,
    })

    const kb = new InlineKeyboard().text(
      t(ctx, 'incoming.mark_paid'),
      `bill:mark_paid:${participant.id}`
    )

    try {
      const msg = await bot.api.sendMessage(Number(participantUser.telegram_id), text, {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      await saveNotificationMessageId(participant.id, BigInt(msg.message_id))
    } catch {
      // Don't abort — notify remaining participants
    }
  }
}

export async function notifyCreatorOfPaymentMark(
  bot: Bot<MyContext>,
  participantId: string
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) return

  // Edit participant's notification message to "awaiting confirmation"
  if (participant.notification_message_id && participant.contact.linked_user_id) {
    const participantUser = await findById(participant.contact.linked_user_id)
    if (participantUser) {
      const ctx = langCtx(participantUser.language_code)
      await bot.api
        .editMessageText(
          Number(participantUser.telegram_id),
          Number(participant.notification_message_id),
          t(ctx, 'incoming.awaiting_confirmation')
        )
        .catch(() => undefined)
    }
  }

  // Notify creator with confirm/dispute buttons
  const details = await getBillWithDetails(participant.bill_id)
  if (!details) return

  const ctx = langCtx(details.creator.language_code)
  const kb = new InlineKeyboard()
    .text(t(ctx, 'payment.confirm_button'), `bill:confirm:${participantId}`)
    .text(t(ctx, 'payment.dispute_button'), `bill:dispute:${participantId}`)

  const text = t(ctx, 'payment.marked_paid_notify', {
    name: participant.contact.display_name,
    amount: formatMoney(participant.amount),
  })

  await bot.api
    .sendMessage(Number(details.creator.telegram_id), text, {
      parse_mode: 'HTML',
      reply_markup: kb,
    })
    .catch(() => undefined)
}

export async function notifyParticipantConfirmed(
  bot: Bot<MyContext>,
  participantId: string
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant?.contact.linked_user_id) return

  const participantUser = await findById(participant.contact.linked_user_id)
  if (!participantUser) return

  const ctx = langCtx(participantUser.language_code)
  const text = t(ctx, 'payment.confirmed_participant')

  if (participant.notification_message_id) {
    await bot.api
      .editMessageText(
        Number(participantUser.telegram_id),
        Number(participant.notification_message_id),
        text
      )
      .catch(() =>
        bot.api.sendMessage(Number(participantUser.telegram_id), text).catch(() => undefined)
      )
  } else {
    await bot.api
      .sendMessage(Number(participantUser.telegram_id), text)
      .catch(() => undefined)
  }
}

export async function notifyParticipantDisputed(
  bot: Bot<MyContext>,
  participantId: string,
  reason: string
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant?.contact.linked_user_id) return

  const participantUser = await findById(participant.contact.linked_user_id)
  if (!participantUser) return

  const ctx = langCtx(participantUser.language_code)
  const text = t(ctx, 'payment.disputed_participant', { reason })

  await bot.api
    .sendMessage(Number(participantUser.telegram_id), text)
    .catch(() => undefined)
}

export async function sendReminder(
  bot: Bot<MyContext>,
  participantId: string
): Promise<boolean> {
  const updated = await remindParticipant(participantId)
  if (!updated) return false

  const participant = await getParticipantById(participantId)
  if (!participant?.contact.linked_user_id) return false

  const participantUser = await findById(participant.contact.linked_user_id)
  if (!participantUser) return false

  const ctx = langCtx(participantUser.language_code)
  const text = t(ctx, 'payment.reminder_message', {
    title: participant.bill.title,
    amount: formatMoney(participant.amount),
  })

  await bot.api
    .sendMessage(Number(participantUser.telegram_id), text)
    .catch(() => undefined)

  return true
}
