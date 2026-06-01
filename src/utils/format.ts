const TZ = 'Asia/Tashkent'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatMoney(amount: bigint): string {
  // Convert to number only for display — UZS bill totals safely fit in Number
  const n = Number(amount)
  const formatted = n.toLocaleString('ru-RU').replace(/,/g, ' ')
  return `${formatted} UZS`
}

export function formatDate(date: Date): string {
  return dateFormatter.format(date)
}

const STATUS_LABELS: Record<string, string> = {
  pending: '⏳ Ожидает',
  marked_paid: '💸 Отмечено оплаченным',
  confirmed: '✅ Подтверждено',
  disputed: '❌ Оспорено',
  draft: '📝 Черновик',
  sent: '📤 Отправлено',
  settled: '✅ Завершено',
  cancelled: '❌ Отменено',
}

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function formatParticipantSummary(paid: number, total: number): string {
  return `${paid}/${total} оплачено`
}
