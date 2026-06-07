// UZS money formatting — matches the Splitwell prototype's `money()` for the
// "sum" currency (whole som, grouped thousands, "so'm" suffix).

export function money(n: number, opts: { signed?: boolean } = {}): string {
  const value = Math.round(Math.abs(n))
  const grouped = value.toLocaleString('en-US')
  const sign = opts.signed && n > 0 ? '+' : opts.signed && n < 0 ? '−' : ''
  return `${sign}${grouped} so'm`
}
