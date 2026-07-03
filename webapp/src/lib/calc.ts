// Client-side total *preview* for the Split editor. The authoritative total is
// computed server-side by utils/settlement.computeSettlement on create; this just
// mirrors its shape (weighted units + proportional service + tip, at 2-decimal
// precision).

import type { DraftBill, DraftItem } from './draft'

/** Truncate to 2 decimals (floor at the cent), dust-guarded — mirrors the
 * server's `to2` in utils/settlement. */
export function to2(n: number): number {
  return Math.floor(n * 100 + 1e-6) / 100
}

function itemQty(it: DraftItem): number {
  return Math.max(1, Math.floor(it.qty || 1))
}

export function previewTotals(draft: DraftBill): {
  subtotal: number
  service: number
  tip: number
  total: number
} {
  const subtotal = draft.items.reduce(
    (s, it) => s + (it.who.length > 0 && it.price > 0 ? it.price * itemQty(it) : 0),
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
 * computeSettlement (utils/settlement): explicitly assigned units cost
 * `units × price`, the unassigned remainder splits equally among the item's
 * sharers. Only people who share at least one priced item appear; tip splits
 * equally among those distinct sharers, matching the bill after it's sent. */
export function previewShares(draft: DraftBill): { id: string; amount: number }[] {
  const base = new Map<string, number>()
  for (const it of draft.items) {
    const count = it.who.length
    if (count === 0 || it.price <= 0) continue
    const qty = itemQty(it)
    const assigned = it.who.reduce((s, w) => s + (w.units ?? 0), 0)
    const remainder = Math.max(0, qty - assigned)
    const remainderPerHead = (remainder * it.price) / count
    for (const w of it.who) {
      const share = to2((w.units ?? 0) * it.price + remainderPerHead)
      base.set(w.id, to2((base.get(w.id) ?? 0) + share))
    }
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
