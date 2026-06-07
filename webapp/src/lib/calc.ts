// Client-side total *preview* for the Split editor. The authoritative total is
// computed server-side by utils/settlement.computeSettlement on create; this just
// mirrors its shape (subtotal + proportional service, rounded to 100, + tip).

import type { DraftBill } from './draft'

export function round100(n: number): number {
  return Math.round(n / 100) * 100
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
    subtotal,
    service: Math.round(service),
    tip,
    total: round100(subtotal + service) + tip,
  }
}
