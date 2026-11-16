import type { UserCard } from './types'

/** "Ish karta" (custom name) or the composed "Uzcard ••6789". */
export function cardLabel(c: UserCard): string {
  return c.label ?? `${c.network} ••${c.last4}`
}

export function defaultCardId(cards: UserCard[]): string | null {
  return cards.find((c) => c.isDefault)?.id ?? null
}

/** "8600123456789012" -> "8600 1234 5678 9012" (mirrors src/utils/format.ts). */
export function formatCard(digits: string): string {
  return digits.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4')
}
