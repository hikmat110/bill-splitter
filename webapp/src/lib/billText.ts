// Builds the plain-text, copy-paste summary a creator hands to people who aren't on
// the bot (no Telegram notification reaches them). One text covers the whole bill —
// items, totals, and every person's split. Mirrors the on-screen breakdown
// (BreakdownLines) and reuses the language-aware money() formatter so the currency
// suffix matches the rest of the app.

import { money } from './currency'
import { to2 } from './calc'
import type { I18nKey } from '../i18n'
import type { BillDetail, Me } from './types'

type TFn = (key: I18nKey, vars?: Record<string, string | number>) => string

/** "8600123456789012" -> "8600 1234 5678 9012" (mirrors src/utils/format.ts). */
export function formatCard(digits: string): string {
  return digits.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4')
}

/** The whole bill rendered as plain text, ready to paste into WhatsApp/SMS. */
export function buildBillText(bill: BillDetail, me: Me, t: TFn): string {
  const lines: string[] = [`📋 ${bill.title}`, '']

  // The original bill — every item, full price — then the totals.
  lines.push(t('share.items_header'))
  for (const item of bill.items) {
    const label = item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name
    lines.push(`  ${label}: ${money(item.price * item.quantity)}`)
  }
  const service = to2(bill.total - bill.subtotal - bill.tip)
  if (service > 0) lines.push(`${t('breakdown.service')}: ${money(service)}`)
  if (bill.tip > 0) lines.push(`${t('breakdown.tip')}: ${money(bill.tip)}`)
  lines.push(t('share.total', { amount: money(bill.total) }))
  lines.push('')

  // Per-person split — everyone, including the creator. Zero service/tip lines are
  // omitted (as in BreakdownLines).
  lines.push(t('share.breakdown_header'))
  for (const p of bill.participants) {
    lines.push(t('share.owes_line', { name: p.displayName, amount: money(p.amount) }))
    for (const it of p.items) {
      lines.push(`  • ${it.name}: ${money(it.share)}`)
    }
    if (p.service > 0) lines.push(`  ${t('breakdown.service')}: ${money(p.service)}`)
    if (p.tip > 0) lines.push(`  ${t('breakdown.tip')}: ${money(p.tip)}`)
    if (p.tipPaid > 0) {
      lines.push(`  ${t('breakdown.tip_paid')}: ${money(-p.tipPaid, { signed: true })}`)
    }
    lines.push('')
  }

  if (me.cardNumber) {
    lines.push(t('share.pay_to', { card: formatCard(me.cardNumber) }), '')
  }

  lines.push(t('share.footer'))
  return lines.join('\n')
}
