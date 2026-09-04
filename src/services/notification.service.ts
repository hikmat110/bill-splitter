import { InlineKeyboard, InputFile, type Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import {
  getBillWithDetails,
  getParticipantById,
  saveNotificationMessageId,
  remindParticipant,
  listUnnotifiedPendingForUser,
} from './bill.service'
import { config } from '../config'
import type { BillWithDetails, BillParticipantWithContact } from './bill.service'
import { attachmentPath } from './storage.service'
import { findById } from './user.service'
import { formatMoney, formatCard } from '../utils/format'
import { classifySendError } from '../utils/telegram-errors'
import type { SendFailureCode } from '../utils/telegram-errors'
import { rootLogger } from '../bot/middleware/logger'
import { t, langCtx } from '../i18n'

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
  participant: BillParticipantWithContact
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
  if (details.card) {
    text += '\n\n' + t(ctx, 'payment.card_line', { card: formatCard(details.card.number) })
  }

  const kb = new InlineKeyboard().text(
    t(ctx, 'incoming.mark_paid'),
    `bill:mark_paid:${participant.id}`
  )
  if (config.WEBAPP_URL) {
    kb.row().webApp(
      t(ctx, 'incoming.open_in_app'),
      `${config.WEBAPP_URL}?startapp=bill_${details.bill.id}`
    )
  }

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
  billId: string
): Promise<void> {
  const details = await getBillWithDetails(billId)
  if (!details) return

  for (const participant of details.participants) {
    await notifyParticipantOfBill(bot, details, participant)
  }
}

/**
 * Deliver bill notifications that predate a user's registration. Their contact
 * rows were linked by the registration backfill, so shares that never got a
 * message (no notification_message_id) are now reachable. A successful send
 * records the message id, making repeat calls no-ops.
 */
export async function notifyPendingBillsForNewUser(
  bot: Bot<MyContext>,
  userId: string
): Promise<void> {
  for (const { bill, participant } of await listUnnotifiedPendingForUser(userId)) {
    const details = await getBillWithDetails(bill.id)
    const row = details?.participants.find((p) => p.id === participant.id)
    if (details && row) await notifyParticipantOfBill(bot, details, row)
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
    await notifyParticipantOfBill(bot, details, participant)
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

// ─── feedback → admin DMs ─────────────────────────────────────────────────────

/** Telegram photo-caption hard limit. */
const CAPTION_MAX = 1024

const FEEDBACK_HEADERS: Record<string, string> = {
  bug: '🐞 Bug report',
  suggestion: '💡 Suggestion',
  other: '💬 Feedback',
}

export interface FeedbackCaptionInput {
  category: string
  message: string
  screen: string
  buildId: string
  platform: string
  tgVersion: string
  language: string
  reporter: {
    first_name: string
    last_name: string | null
    username: string | null
    telegram_id: bigint
  }
  attachmentCount: number
}

/**
 * Compose the admin DM for a feedback submission. Plain text (sent without
 * parse_mode — the message is user input), fits Telegram's 1024-char photo
 * caption by truncating the message portion; the admin screen has the full text.
 */
export function buildFeedbackCaption(input: FeedbackCaptionInput): string {
  const r = input.reporter
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ')
  const from = [name, r.username ? `@${r.username}` : null, `id ${r.telegram_id}`]
    .filter(Boolean)
    .join(' · ')

  const head = `${FEEDBACK_HEADERS[input.category] ?? FEEDBACK_HEADERS.other}\nFrom: ${from}`
  const contextLine = [
    input.screen,
    input.buildId,
    `${input.platform} ${input.tgVersion}`.trim(),
    input.language,
  ]
    .filter(Boolean)
    .join(' · ')
  const tail =
    contextLine +
    (input.attachmentCount > 1
      ? `\n+${input.attachmentCount - 1} more photo(s) in the admin screen`
      : '')

  const overhead = head.length + tail.length + 4 // the two "\n\n" separators
  const room = Math.max(0, CAPTION_MAX - overhead)
  const message =
    input.message.length > room ? input.message.slice(0, Math.max(0, room - 1)) + '…' : input.message

  return `${head}\n\n${message}\n\n${tail}`
}

/**
 * DM every admin in ADMIN_TELEGRAM_IDS about a new feedback — as a photo when a
 * screenshot exists (auto-capture preferred). Best-effort per admin; an empty
 * admin list is a no-op (the feedback is already stored).
 */
export async function notifyAdminsOfFeedback(
  bot: Bot<MyContext>,
  input: FeedbackCaptionInput & {
    attachments: { attachment_id: string; mime: string; is_auto_capture: boolean }[]
  }
): Promise<void> {
  const caption = buildFeedbackCaption(input)
  const photo =
    input.attachments.find((a) => a.is_auto_capture) ?? input.attachments[0] ?? null

  for (const adminId of config.ADMIN_TELEGRAM_IDS) {
    await (photo
      ? bot.api.sendPhoto(
          adminId,
          new InputFile(attachmentPath(photo.attachment_id, photo.mime)),
          { caption }
        )
      : bot.api.sendMessage(adminId, caption)
    ).catch(() => undefined)
  }
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

export type AdminSendResult = { ok: true } | { ok: false; code: SendFailureCode }

/**
 * DM one user on behalf of an admin. The text is prefixed with a line in the
 * recipient's language so the message has context, and sent without a
 * parse_mode so admin-typed text can't trip Telegram's entity parser. Failures
 * are classified (blocked / chat not found / rate limited / other) rather than
 * swallowed — the admin needs to know the message didn't land.
 */
export async function sendAdminMessage(
  bot: Bot<MyContext>,
  recipient: { telegram_id: bigint; language_code: string },
  text: string
): Promise<AdminSendResult> {
  const ctx = langCtx(recipient.language_code)
  const body = `${t(ctx, 'admin.dm_prefix')}\n\n${text}`
  try {
    await bot.api.sendMessage(Number(recipient.telegram_id), body)
    return { ok: true }
  } catch (err) {
    const code = classifySendError(err)
    rootLogger.warn({ err, telegramId: Number(recipient.telegram_id), code }, 'Admin DM failed')
    return { ok: false, code }
  }
}
