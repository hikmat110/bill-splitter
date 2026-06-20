import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { t, statusLabel } from '../../i18n'
import {
  listBillsForParticipant,
  getBillWithDetails,
  getBillBreakdown,
  getParticipantById,
  markParticipantPaid,
} from '../../services/bill.service'
import { notifyCreatorOfPaymentMark } from '../../services/notification.service'
import {
  incomingListKeyboard,
  incomingDetailKeyboard,
  proofSkipKeyboard,
} from '../keyboards'
import { formatMoney } from '../../utils/format'

export async function incomingHandler(ctx: MyContext): Promise<void> {
  const rows = await listBillsForParticipant(ctx.user.id)

  const text = rows.length === 0
    ? t(ctx, 'incoming.empty')
    : t(ctx, 'incoming.title')

  const kb = rows.length === 0
    ? undefined
    : incomingListKeyboard(
        rows.map((r) => ({
          participantId: r.participant.id,
          title: `${r.bill.title} — ${formatMoney(r.participant.amount)} (${statusLabel(ctx, r.participant.status)})`,
        })),
        ctx
      )

  await editOrReply(ctx, text, kb)
}

export async function incomingDetailHandler(ctx: MyContext, participantId: string): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await editOrReply(ctx, t(ctx, 'errors.not_found'))
    return
  }

  const details = await getBillWithDetails(participant.bill_id)
  if (!details) {
    await editOrReply(ctx, t(ctx, 'errors.not_found'))
    return
  }

  const lines = [
    t(ctx, 'incoming.detail_title', { title: details.bill.title }),
    t(ctx, 'incoming.your_share', { amount: formatMoney(participant.amount) }),
    t(ctx, 'incoming.status_label', { status: statusLabel(ctx, participant.status) }),
  ]

  // Recipient sees only their own items — what they're paying for.
  const own = getBillBreakdown(details).get(participant.contact_id)
  if (own && own.items.length > 0) {
    lines.push(t(ctx, 'incoming.your_items_header'))
    for (const it of own.items) {
      lines.push(t(ctx, 'history.detail_item_share', { name: it.name, amount: formatMoney(it.share) }))
    }
    if (own.service > 0) lines.push(t(ctx, 'history.detail_service_line', { amount: formatMoney(own.service) }))
    if (own.tip > 0) lines.push(t(ctx, 'history.detail_tip_line', { amount: formatMoney(own.tip) }))
  }

  await editOrReply(
    ctx,
    lines.join('\n'),
    incomingDetailKeyboard(participant.id, participant.status, ctx),
    'HTML'
  )
}

export async function markPaidCallbackHandler(
  ctx: MyContext,
  participantId: string,
  _bot: Bot<MyContext>
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await editOrReply(ctx, t(ctx, 'errors.not_found'))
    return
  }

  if (participant.contact.linked_user_id !== ctx.user.id) {
    await editOrReply(ctx, t(ctx, 'errors.not_your_action'))
    return
  }

  if (participant.status !== 'pending') return

  // Don't mark paid yet — first ask for an optional transfer-receipt photo.
  // The actual markParticipantPaid happens once a photo arrives (photoHandler)
  // or the user taps Skip (markPaidSkipHandler).
  ctx.session.mark_paid_wizard = { step: 'awaiting_proof', participantId }
  const promptMsgId = ctx.callbackQuery?.message?.message_id
  if (promptMsgId) ctx.session.mark_paid_wizard.promptMessageId = promptMsgId

  // The notification may have been sent as a photo (bill with a main receipt),
  // which editMessageText can't edit — fall back to caption, then a fresh message.
  const prompt = t(ctx, 'incoming.proof_prompt')
  const kb = proofSkipKeyboard(participantId, ctx)
  await ctx
    .editMessageText(prompt, { reply_markup: kb })
    .catch(() => ctx.editMessageCaption({ caption: prompt, reply_markup: kb }))
    .catch(() => ctx.reply(prompt, { reply_markup: kb }))
    .catch(() => undefined)
}

export async function markPaidSkipHandler(
  ctx: MyContext,
  participantId: string,
  bot: Bot<MyContext>
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await editOrReply(ctx, t(ctx, 'errors.not_found'))
    return
  }

  if (participant.contact.linked_user_id !== ctx.user.id) {
    await editOrReply(ctx, t(ctx, 'errors.not_your_action'))
    return
  }

  ctx.session.mark_paid_wizard = undefined

  if (participant.status !== 'pending') return

  await markParticipantPaid(participantId)
  await notifyCreatorOfPaymentMark(bot, participantId)

  await ctx.editMessageText(t(ctx, 'incoming.awaiting_confirmation')).catch(() => undefined)
}

async function editOrReply(
  ctx: MyContext,
  text: string,
  keyboard?: import('grammy').InlineKeyboard,
  parseMode?: 'HTML'
): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, {
      reply_markup: keyboard,
      parse_mode: parseMode,
    }).catch(() => undefined)
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: parseMode })
  }
}
