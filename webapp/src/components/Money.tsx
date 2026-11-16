import type { CSSProperties } from 'react'
import { money } from '../lib/currency'

export function Money({
  amount,
  signed,
  className = '',
  style,
}: {
  amount: number
  signed?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={'tnum ' + className} style={style}>
      {money(amount, { signed })}
    </span>
  )
}
