// UZS money formatting — matches the Splitwell prototype's `money()` for the
// "sum" currency (whole som, grouped thousands, localized currency suffix).

const SUFFIX: Record<string, string> = { uz: "so'm", en: "so'm", ru: 'сум' }

// Set by the i18n provider so the (non-React) formatter follows the UI language.
let lang = 'uz'
export function setMoneyLang(code: string): void {
  lang = code
}

/** Grouped number with no currency suffix — e.g. 10000 -> "10,000". Used where the
 *  unit is already implied (e.g. the tip-slider presets) so labels stay compact. */
export function amount(n: number): string {
  // Real 2-decimal som: show decimals only when the amount isn't whole.
  return Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function money(n: number, opts: { signed?: boolean } = {}): string {
  const sign = opts.signed && n > 0 ? '+' : opts.signed && n < 0 ? '−' : ''
  return `${sign}${amount(n)} ${SUFFIX[lang] ?? "so'm"}`
}
