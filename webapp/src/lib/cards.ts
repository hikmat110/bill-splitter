import type { UserCard } from './types'

/** "Ish karta" (custom name) or the composed "Uzcard ••6789". */
export function cardLabel(c: UserCard): string {
  return c.label ?? `${c.network} ••${c.last4}`
}

export function defaultCardId(cards: UserCard[]): string | null {
  return cards.find((c) => c.isDefault)?.id ?? null
}
