import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { t, statusLabel } from '../../i18n'
import {
  listBillsCreatedBy,
  listBillsForParticipant,
  getBillWithDetails,
} from '../../services/bill.service'
import { sendReminder } from '../../services/notification.service'
import {
  historyTabKeyboard,
  historyBillKeyboard,
} from '../keyboards'
import { formatMoney, formatDate } from '../../utils/format'

export async function historyHandler(ctx: MyContext): Promise<void> {
  await showHistoryTab(ctx, 'created')
}

export async function historyTabHandler(ctx: MyContext, tab: string): Promise<void> {
  const activeTab = tab === 'received' ? 'received' : 'created'
  await showHistoryTab(ctx, activeTab)
}

async function showHistoryTab(
  ctx: MyContext,
  tab: 'created' | 'received'
): Promise<void> {
  let lines: string[]

  if (tab === 'created') {
    const billsList = await listBillsCreatedBy(ctx.user.id)
    if (billsList.length === 0) {
      lines = [t(ctx, 'history.empty')]
    } else {
      lines = billsList.map((b) =>
        `• <b>${b.title}</b> — ${formatMoney(b.total)} [${statusLabel(ctx, b.status)}]`
      )
    }
  } else {
    const rows = await listBillsForParticipant(ctx.user.id)
    if (rows.length === 0) {
      lines = [t(ctx, 'history.empty')]
    } else {
      lines = rows.map(
        (r) =>
          `• <b>${r.bill.title}</b> — ${formatMoney(r.participant.amount)} [${statusLabel(ctx, r.participant.status)}]`
      )
    }
  }

  const text = `${t(ctx, 'history.title')}\n\n${lines.join('\n')}`
  const kb = historyTabKeyboard(tab, ctx)

  await editOrReply(ctx, text, kb, 'HTML')
}

export async function historyDetailHandler(ctx: MyContext, billId: string): Promise<void> {
  const details = await getBillWithDetails(billId)
  if (!details) {
    await editOrReply(ctx, t(ctx, 'errors.not_found'))
    return
  }

  const { bill, items, participants } = details

  const lines: string[] = [
    t(ctx, 'history.detail_title', { title: bill.title }),
    t(ctx, 'history.detail_date', { date: formatDate(bill.created_at) }),
    '',
  ]

  for (const item of items) {
    lines.push(`  ${item.name} × ${item.quantity}: ${formatMoney(item.price * BigInt(item.quantity))}`)
  }
  lines.push('')
  lines.push(t(ctx, 'history.detail_total', { amount: formatMoney(bill.total) }))
  lines.push('')

  const paidCount = participants.filter((p) => p.status === 'confirmed').length
  lines.push(t(ctx, 'history.detail_payment', { summary: `${paidCount}/${participants.length}` }))
  for (const p of participants) {
    lines.push(t(ctx, 'history.detail_participant_line', {
      name: p.contact.display_name,
      amount: formatMoney(p.amount),
      status: statusLabel(ctx, p.status),
    }))
  }

  const unpaid = participants
    .filter((p) => p.status === 'pending' || p.status === 'disputed')
    .map((p) => ({ id: p.id, contactName: p.contact.display_name }))

  await editOrReply(ctx, lines.join('\n'), historyBillKeyboard(unpaid, ctx), 'HTML')
}

export async function remindHandler(
  ctx: MyContext,
  participantId: string,
  bot: Bot<MyContext>
): Promise<void> {
  const sent = await sendReminder(bot, participantId)
  if (sent) {
    await ctx.answerCallbackQuery(t(ctx, 'payment.remind_sent'))
  } else {
    await ctx.answerCallbackQuery(t(ctx, 'payment.remind_too_soon'))
  }
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
