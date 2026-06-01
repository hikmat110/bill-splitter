import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { confirmPayment, disputePayment, getParticipantById } from '../../services/bill.service'
import {
  notifyParticipantConfirmed,
  notifyParticipantDisputed,
} from '../../services/notification.service'

export async function confirmPaymentHandler(
  ctx: MyContext,
  participantId: string,
  bot: Bot<MyContext>
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await ctx.reply(t(ctx, 'errors.not_found'))
    return
  }

  // Only the bill creator can confirm
  if (participant.bill.creator_id !== ctx.user.id) {
    await ctx.reply(t(ctx, 'errors.not_your_action'))
    return
  }

  await confirmPayment(participantId)
  await notifyParticipantConfirmed(bot, participantId)

  await ctx.editMessageText(t(ctx, 'payment.confirmed_creator')).catch(() =>
    ctx.reply(t(ctx, 'payment.confirmed_creator'))
  )
}

export async function disputeStartHandler(ctx: MyContext, participantId: string): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) {
    await ctx.reply(t(ctx, 'errors.not_found'))
    return
  }

  if (participant.bill.creator_id !== ctx.user.id) {
    await ctx.reply(t(ctx, 'errors.not_your_action'))
    return
  }

  ctx.session.dispute_wizard = { step: 'awaiting_reason', participantId }
  await ctx.reply(t(ctx, 'payment.dispute_prompt'))
}

export async function disputeReasonHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const wizard = ctx.session.dispute_wizard
  if (!wizard) return

  const reason = ctx.message?.text?.trim()
  if (!reason) return

  ctx.session.dispute_wizard = undefined

  await disputePayment(wizard.participantId)
  await notifyParticipantDisputed(bot, wizard.participantId, reason)

  await ctx.reply(t(ctx, 'payment.disputed_creator'))
}
