const TZ = 'Asia/Tashkent'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatMoney(amount: number): string {
  // Real 2-decimal som; show decimals only when the amount isn't whole. ru-RU
  // groups thousands with a space and uses a comma decimal separator, e.g.
  // "33 333,33 UZS" / "100 000 UZS".
  const formatted = amount.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
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
