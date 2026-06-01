import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import {
  listBillsForParticipant,
  getBillWithDetails,
  getParticipantById,
  markParticipantPaid,
} from '../../services/bill.service'
import { notifyCreatorOfPaymentMark } from '../../services/notification.service'
import {
  incomingListKeyboard,
  incomingDetailKeyboard,
} from '../keyboards'
import { formatMoney, formatStatus } from '../../utils/format'

export async function incomingHandler(ctx: MyContext): Promise<void> {
  const rows = await listBillsForParticipant(ctx.user.id)

  if (rows.length === 0) {
    await ctx.reply(t(ctx, 'incoming.empty'))
    return
  }

  const items = rows.map((r) => ({
    participantId: r.participant.id,
    title: `${r.bill.title} — ${formatMoney(r.participant.amount)} (${formatStatus(r.participant.status)})`,
  }))

  await ctx.reply(t(ctx, 'incoming.title'), {
    reply_markup: incomingListKeyboard(items, ctx),
  })
}

export async function incomingDetailHandler(ctx: MyContext, participantId: string): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await ctx.reply(t(ctx, 'errors.not_found'))
    return
  }

  const details = await getBillWithDetails(participant.bill_id)
  if (!details) {
    await ctx.reply(t(ctx, 'errors.not_found'))
    return
  }

  const lines = [
    t(ctx, 'incoming.detail_title', { title: details.bill.title }),
    t(ctx, 'incoming.your_share', { amount: formatMoney(participant.amount) }),
    t(ctx, 'incoming.status_label', { status: formatStatus(participant.status) }),
  ]

  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: incomingDetailKeyboard(participant.id, participant.status, ctx),
  }).catch(() =>
    ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: incomingDetailKeyboard(participant.id, participant.status, ctx),
    })
  )
}

export async function markPaidCallbackHandler(
  ctx: MyContext,
  participantId: string,
  bot: Bot<MyContext>
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await ctx.reply(t(ctx, 'errors.not_found'))
    return
  }

  // Only the linked user can mark their own share as paid
  if (participant.contact.linked_user_id !== ctx.user.id) {
    await ctx.reply(t(ctx, 'errors.not_your_action'))
    return
  }

  if (participant.status !== 'pending') {
    return
  }

  await markParticipantPaid(participantId)
  await notifyCreatorOfPaymentMark(bot, participantId)

  await ctx.editMessageText(t(ctx, 'incoming.awaiting_confirmation')).catch(() => undefined)
}
