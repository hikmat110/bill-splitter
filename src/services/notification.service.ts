import { InlineKeyboard, InputFile, type Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import {
  getBillWithDetails,
  getParticipantById,
  saveNotificationMessageId,
  remindParticipant,
} from './bill.service'
import type { BillWithDetails, BillParticipantWithContact } from './bill.service'
import { attachmentPath } from './storage.service'
import { findById } from './user.service'
import { formatMoney, formatCard } from '../utils/format'
import { t } from '../i18n'
import type { Context } from 'grammy'

// Minimal context shim for t() when no real bot context is available
function langCtx(lang: string): Context {
  return { from: { language_code: lang } } as unknown as Context
}

/** Edit a notification message to new text, transparently handling the case
 *  where the original was sent as a photo (caption) rather than plain text. */
async function editNotification(
  bot: Bot<MyContext>,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  await bot.api
    .editMessageText(chatId, messageId, text)
    .catch(() => bot.api.editMessageCaption(chatId, messageId, { caption: text }))
    .catch(() => undefined)
}

/** Send (or re-send) the bill notification to a single participant, as a photo
 *  when the bill has a main receipt, else plain text. Records the message id. */
async function notifyParticipantOfBill(
  bot: Bot<MyContext>,
  details: BillWithDetails,
  participant: BillParticipantWithContact,
  creatorCardNumber?: string | null
): Promise<void> {
  if (!participant.contact.linked_user_id) return
  // Skip notifying the creator about their own share
  if (participant.contact.linked_user_id === details.bill.creator_id) return

  const participantUser = await findById(participant.contact.linked_user_id)
  if (!participantUser) return

  const ctx = langCtx(participantUser.language_code)
  let text = t(ctx, 'payment.notification_message', {
    title: details.bill.title,
    amount: formatMoney(participant.amount),
    creator: details.creator.first_name,
  })
  if (creatorCardNumber) {
    text += '\n\n' + t(ctx, 'payment.card_line', { card: formatCard(creatorCardNumber) })
  }

  const kb = new InlineKeyboard().text(
    t(ctx, 'incoming.mark_paid'),
    `bill:mark_paid:${participant.id}`
  )

  const chatId = Number(participantUser.telegram_id)
  const { receipt_attachment_id, receipt_mime } = details.bill
  try {
    const msg =
      receipt_attachment_id && receipt_mime
        ? await bot.api.sendPhoto(
            chatId,
            new InputFile(attachmentPath(receipt_attachment_id, receipt_mime)),
            { caption: text, parse_mode: 'HTML', reply_markup: kb }
          )
        : await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb })
    await saveNotificationMessageId(participant.id, BigInt(msg.message_id))
  } catch {
    // Don't abort — notify remaining participants
  }
}

export async function sendBillNotifications(
  bot: Bot<MyContext>,
  billId: string,
  creatorCardNumber?: string | null
): Promise<void> {
  const details = await getBillWithDetails(billId)
  if (!details) return

  for (const participant of details.participants) {
    await notifyParticipantOfBill(bot, details, participant, creatorCardNumber)
  }
}

/**
 * Re-send notifications after a bill edit. The bill content changed (and a main
 * photo may have appeared or disappeared), and you can't edit a message between
 * text and photo forms, so we delete each participant's old message and send a
 * fresh one. `oldMessageIds` maps contact_id → the prior notification_message_id
 * (captured before the edit, since updateBill wipes them).
 */
export async function resendBillNotifications(
  bot: Bot<MyContext>,
  billId: string,
  creatorCardNumber: string | null | undefined,
  oldMessageIds: Map<string, bigint>
): Promise<void> {
  const details = await getBillWithDetails(billId)
  if (!details) return

  for (const participant of details.participants) {
    if (!participant.contact.linked_user_id) continue
    if (participant.contact.linked_user_id === details.bill.creator_id) continue

    const oldId = oldMessageIds.get(participant.contact_id)
    if (oldId) {
      const participantUser = await findById(participant.contact.linked_user_id)
      if (participantUser) {
        await bot.api
          .deleteMessage(Number(participantUser.telegram_id), Number(oldId))
          .catch(() => undefined)
      }
    }
    await notifyParticipantOfBill(bot, details, participant, creatorCardNumber)
  }
}

/**
 * Rewrite every participant's bill notification to "this bill was deleted",
 * clearing the stale Mark-paid button. Must run BEFORE the DB delete (it needs
 * the message ids and telegram ids). Best-effort per participant.
 */
export async function notifyBillDeleted(
  bot: Bot<MyContext>,
  details: BillWithDetails
): Promise<void> {
  for (const participant of details.participants) {
    if (!participant.contact.linked_user_id) continue
    if (participant.contact.linked_user_id === details.bill.creator_id) continue
    if (!participant.notification_message_id) continue

    const participantUser = await findById(participant.contact.linked_user_id)
    if (!participantUser) continue

    const ctx = langCtx(participantUser.language_code)
    await editNotification(
      bot,
      Number(participantUser.telegram_id),
      Number(participant.notification_message_id),
      t(ctx, 'payment.bill_deleted', { title: details.bill.title })
    )
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
      await editNotification(
        bot,
        Number(participantUser.telegram_id),
        Number(participant.notification_message_id),
        t(ctx, 'incoming.awaiting_confirmation')
      )
    }
  }

  // Notify creator with confirm/dispute buttons — as a photo when the payer
  // attached a proof of transfer, so the creator can see it inline.
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

  const creatorChatId = Number(details.creator.telegram_id)
  const { payment_proof_attachment_id, payment_proof_mime } = participant
  await (payment_proof_attachment_id && payment_proof_mime
    ? bot.api.sendPhoto(
        creatorChatId,
        new InputFile(attachmentPath(payment_proof_attachment_id, payment_proof_mime)),
        { caption: text, parse_mode: 'HTML', reply_markup: kb }
      )
    : bot.api.sendMessage(creatorChatId, text, { parse_mode: 'HTML', reply_markup: kb })
  ).catch(() => undefined)
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
  const chatId = Number(participantUser.telegram_id)

  if (participant.notification_message_id) {
    const mid = Number(participant.notification_message_id)
    await bot.api
      .editMessageText(chatId, mid, text)
      .catch(() => bot.api.editMessageCaption(chatId, mid, { caption: text }))
      .catch(() => bot.api.sendMessage(chatId, text))
      .catch(() => undefined)
  } else {
    await bot.api.sendMessage(chatId, text).catch(() => undefined)
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
