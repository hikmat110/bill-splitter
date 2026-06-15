// Client-side total *preview* for the Split editor. The authoritative total is
// computed server-side by utils/settlement.computeSettlement on create; this just
// mirrors its shape (subtotal + proportional service + tip, at 2-decimal precision).

import type { DraftBill } from './draft'

/** Truncate to 2 decimals (floor at the cent), dust-guarded — mirrors the
 * server's `to2` in utils/settlement. */
export function to2(n: number): number {
  return Math.floor(n * 100 + 1e-6) / 100
}

export function previewTotals(draft: DraftBill): {
  subtotal: number
  service: number
  tip: number
  total: number
} {
  const subtotal = draft.items.reduce(
    (s, it) => s + (it.who.length > 0 && it.price > 0 ? it.price : 0),
    0
  )
  const service = (subtotal * (draft.servicePct || 0)) / 100
  const tip = draft.tip || 0
  return {
    subtotal: to2(subtotal),
    service: to2(service),
    tip,
    total: to2(subtotal + service) + tip,
  }
}
