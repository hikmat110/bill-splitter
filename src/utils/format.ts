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

/** Format 16-digit card number string as "XXXX XXXX XXXX XXXX" */
export function formatCard(digits: string): string {
  return digits.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4')
}

/** Mask card: show only last 4 digits */
export function maskCard(digits: string): string {
  return `**** **** **** ${digits.slice(-4)}`
}

/** Strip non-digits and validate card number; returns 16 digits or null */
export function parseCardNumber(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  return digits.length === 16 ? digits : null
}

/** @deprecated Use i18n history.paid_summary instead */
export function formatParticipantSummary(paid: number, total: number): string {
  return `${paid}/${total} оплачено`
}
