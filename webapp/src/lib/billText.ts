// Builds the plain-text, copy-paste summary a creator hands to a participant who
// isn't on the bot (no Telegram notification reaches them). Mirrors the on-screen
// breakdown (BreakdownLines) and reuses the language-aware money() formatter so the
// currency suffix matches the rest of the app.

import { money } from './currency'
import type { I18nKey } from '../i18n'
import type { BillDetail, BillParticipant, Me } from './types'

type TFn = (key: I18nKey, vars?: Record<string, string | number>) => string

/** "8600123456789012" -> "8600 1234 5678 9012" (mirrors src/utils/format.ts). */
export function formatCard(digits: string): string {
  return digits.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4')
}

/** One participant's share rendered as plain text, ready to paste into WhatsApp/SMS. */
export function buildParticipantText(
  bill: BillDetail,
  p: BillParticipant,
  me: Me,
  t: TFn
): string {
  const lines: string[] = [`📋 ${bill.title}`, '']

  // The original bill — every item, full price.
  lines.push(t('share.items_header'))
  for (const item of bill.items) {
    const label = item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name
    lines.push(`  ${label}: ${money(item.price * item.quantity)}`)
  }
  lines.push('')

  // This person's split. Zero service/tip lines are omitted (as in BreakdownLines).
  lines.push(t('share.you_owe', { name: p.displayName, amount: money(p.amount) }))
  for (const it of p.items) {
    lines.push(`  • ${it.name}: ${money(it.share)}`)
  }
  if (p.service > 0) lines.push(`  ${t('breakdown.service')}: ${money(p.service)}`)
  if (p.tip > 0) lines.push(`  ${t('breakdown.tip')}: ${money(p.tip)}`)
  if (p.tipPaid > 0) {
    lines.push(`  ${t('breakdown.tip_paid')}: ${money(-p.tipPaid, { signed: true })}`)
  }

  if (me.cardNumber) {
    lines.push('', t('share.pay_to', { card: formatCard(me.cardNumber) }))
  }

  lines.push('', t('share.footer'))
  return lines.join('\n')
}
