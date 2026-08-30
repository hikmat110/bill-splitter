import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { amountText, amountValue, canonicalAmount, formatAmountInput } from '../lib/amount-input'

/** Amount input that stays a `number` for its parent but shows grouped
 *  thousands while typing ("68000" -> "68,000"). It must be `type="text"`: a
 *  `type="number"` input silently blanks any value containing separators. */
export function MoneyInput({
  value,
  onChange,
  integer = false,
  className,
  ...rest
}: {
  value: number
  onChange: (n: number) => void
  /** Whole som only (tip); shows the digits-only keypad. */
  integer?: boolean
  placeholder?: string
  autoFocus?: boolean
  title?: string
  className?: string
  style?: CSSProperties
}) {
  const [text, setText] = useState(() => amountText(value, { integer }))

  // Follow external changes (receipt scan filling prices, draft reset, editing
  // an existing bill) — but only when the number actually differs, so an
  // in-progress "12." (still worth 12) isn't clobbered mid-keystroke.
  useEffect(() => {
    if (amountValue(canonicalAmount(text, { integer })) !== value) {
      setText(amountText(value, { integer }))
    }
  }, [value, integer]) // deliberately not `text`: this only reacts to the prop


  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      className={['inp', 'tnum', className].filter(Boolean).join(' ')}
      value={text}
      onChange={(e) => {
        const el = e.target
        const raw = el.value
        // Digits/dot to the left of the caret survive reformatting; restore the
        // caret after that many of them so mid-string edits don't jump to the end.
        const caret = el.selectionStart ?? raw.length
        const kept = raw.slice(0, caret).replace(/[^0-9.]/g, '').length
        const canonical = canonicalAmount(raw, { integer })
        const next = formatAmountInput(canonical)
        setText(next)
        onChange(amountValue(canonical))
        requestAnimationFrame(() => {
          if (document.activeElement !== el) return
          let pos = 0
          let seen = 0
          while (pos < next.length && seen < kept) {
            if (/[0-9.]/.test(next[pos]!)) seen++
            pos++
          }
          el.setSelectionRange(pos, pos)
        })
      }}
      onBlur={() => setText(amountText(value, { integer }))}
      {...rest}
    />
  )
}
