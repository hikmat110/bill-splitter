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

/** Per-person owed amount preview for the Split editor — mirrors the server's
 * computeSettlement (utils/settlement). Only people who share at least one priced
 * item appear; the tip/service split equally among those distinct sharers, matching
 * what the bill will show after it's sent. */
export function previewShares(draft: DraftBill): { id: string; amount: number }[] {
  const base = new Map<string, number>()
  for (const it of draft.items) {
    const count = it.who.length
    if (count === 0 || it.price <= 0) continue
    const perShare = to2(it.price / count)
    for (const id of it.who) base.set(id, to2((base.get(id) ?? 0) + perShare))
  }

  const ids = draft.participantIds.filter((id) => base.has(id))
  const participantCount = ids.length
  if (participantCount === 0) return []

  const servicePct = draft.servicePct || 0
  const tip = draft.tip || 0
  const rows = ids.map((id) => {
    const b = base.get(id)!
    const service = to2((b * servicePct) / 100)
    const tipShare = to2(tip / participantCount)
    return { id, amount: to2(b + service + tipShare) }
  })

  // Credit the tip payer the full tip they fronted.
  if (draft.tipPaidBy) {
    const payer = rows.find((r) => r.id === draft.tipPaidBy)
    if (payer) payer.amount = Math.round((payer.amount - tip) * 100) / 100
  }
  return rows
}
