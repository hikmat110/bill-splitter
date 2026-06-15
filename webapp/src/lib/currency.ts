// UZS money formatting — matches the Splitwell prototype's `money()` for the
// "sum" currency (whole som, grouped thousands, localized currency suffix).

const SUFFIX: Record<string, string> = { uz: "so'm", en: "so'm", ru: 'сум' }

// Set by the i18n provider so the (non-React) formatter follows the UI language.
let lang = 'uz'
export function setMoneyLang(code: string): void {
  lang = code
}

export function money(n: number, opts: { signed?: boolean } = {}): string {
  // Real 2-decimal som: show decimals only when the amount isn't whole.
  const grouped = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const sign = opts.signed && n > 0 ? '+' : opts.signed && n < 0 ? '−' : ''
  return `${sign}${grouped} ${SUFFIX[lang] ?? "so'm"}`
}
