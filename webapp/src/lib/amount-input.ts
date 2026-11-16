// Parsing/formatting for the live-formatted UZS amount inputs (see
// components/MoneyInput). Pure so the cases that bite formatted inputs — typing
// into an already-grouped string, deleting a digit next to a separator — are
// unit-testable without a DOM.
//
// Grouping matches `amount()` in ./currency (en-US commas) so what the user
// types looks like the `money()` labels next to it. Because the formatter is
// the only thing that puts commas in the field, a comma is ALWAYS a thousands
// separator and only '.' is a decimal point. (A ru-locale iOS decimal keypad
// offers ',' instead of '.', so tiyin can't be typed there — UZS is whole-som
// in practice, and treating a comma as a decimal would break "6,800" + "0".)

const KEEP = /[^0-9.]/g

/** Reduce raw typed text to a canonical numeric string: digits, at most one
 *  '.', at most 2 fraction digits, no leading zeros ("007" -> "7", "0.5" stays).
 *  A trailing '.' is preserved so the user can keep typing ("12." -> "12.").
 *  Returns '' when there is nothing numeric. `integer` drops any fraction. */
export function canonicalAmount(raw: string, opts: { integer?: boolean } = {}): string {
  const cleaned = raw.replace(KEEP, '')
  const dot = cleaned.indexOf('.')
  let int = dot === -1 ? cleaned : cleaned.slice(0, dot)
  let frac: string | null =
    dot === -1 || opts.integer ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  int = int.replace(/^0+(?=\d)/, '')
  if (int === '' && frac === null) return ''
  if (int === '') int = '0' // ".5" -> "0.5"
  return frac === null ? int : `${int}.${frac}`
}

/** Group thousands in a canonical string for display while typing:
 *  "68000" -> "68,000", "1234567.5" -> "1,234,567.5", "12." -> "12.", '' -> ''. */
export function formatAmountInput(canonical: string): string {
  if (canonical === '') return ''
  const [int, frac] = canonical.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/** Canonical string -> number (0 for ''). The string already has ≤ 2 decimals,
 *  so no rounding is needed and no float dust is introduced. */
export function amountValue(canonical: string): number {
  if (canonical === '') return 0
  const n = Number(canonical)
  return Number.isFinite(n) ? n : 0
}

/** Display text for a stored number; 0 -> '' so the placeholder shows. */
export function amountText(n: number, opts: { integer?: boolean } = {}): string {
  return n > 0 ? formatAmountInput(canonicalAmount(String(n), opts)) : ''
}
