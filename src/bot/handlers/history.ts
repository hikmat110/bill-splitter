import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { t, statusLabel } from '../../i18n'
import {
  listBillsCreatedBy,
  listBillsForParticipant,
  getBillWithDetails,
  getBillBreakdown,
  isBillEditable,
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
    // Archived bills stay reachable in the mini-app's Archived filter only.
    const billsList = (await listBillsCreatedBy(ctx.user.id)).filter((b) => !b.archived_at)
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
  const breakdown = getBillBreakdown(details)
  // The creator's own self-participant — they "spent", they don't owe.
  const isSelf = (p: (typeof participants)[number]) =>
    p.contact.linked_user_id === bill.creator_id

  const lines: string[] = [
    t(ctx, 'history.detail_title', { title: bill.title }),
    t(ctx, 'history.detail_date', { date: formatDate(bill.created_at) }),
    '',
  ]

  for (const item of items) {
    lines.push(`  ${item.name} × ${item.quantity}: ${formatMoney(item.price * item.quantity)}`)
  }
  lines.push('')
  lines.push(t(ctx, 'history.detail_total', { amount: formatMoney(bill.total) }))

  // Payment progress counts only people who owe the creator (exclude self).
  const others = participants.filter((p) => !isSelf(p))
  const paidCount = others.filter((p) => p.status === 'confirmed').length
  lines.push('')
  lines.push(t(ctx, 'history.detail_payment', { summary: `${paidCount}/${others.length}` }))

  // Per-person itemized breakdown — creator sees everyone.
  lines.push(t(ctx, 'history.detail_breakdown_header'))
  for (const p of participants) {
    lines.push(
      isSelf(p)
        ? t(ctx, 'history.detail_you_spent', { amount: formatMoney(p.amount) })
        : t(ctx, 'history.detail_owes_line', {
            name: p.contact.display_name,
            amount: formatMoney(p.amount),
            status: statusLabel(ctx, p.status),
          })
    )
    const b = breakdown.get(p.contact_id)
    if (b) {
      for (const it of b.items) {
        const name = it.units ? `${it.name} ×${it.units}` : it.name
        lines.push(t(ctx, 'history.detail_item_share', { name, amount: formatMoney(it.share) }))
      }
      if (b.service > 0) lines.push(t(ctx, 'history.detail_service_line', { amount: formatMoney(b.service) }))
      if (b.tip > 0) lines.push(t(ctx, 'history.detail_tip_line', { amount: formatMoney(b.tip) }))
    }
  }

  const unpaid = others
    .filter((p) => p.status === 'pending' || p.status === 'disputed')
    .map((p) => ({ id: p.id, contactName: p.contact.display_name }))

  // "Edit in app" only for the creator, while the bill is still fully editable.
  const editInApp =
    bill.creator_id === ctx.user.id && isBillEditable(participants, bill.creator_id)
      ? { billId: bill.id }
      : undefined

  await editOrReply(ctx, lines.join('\n'), historyBillKeyboard(unpaid, ctx, editInApp), 'HTML')
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
