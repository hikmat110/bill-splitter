export interface ItemSpec {
  name?: string
  price: number
  shareContactIds: string[]
}

export interface BillSpec {
  items: ItemSpec[]
  servicePct: number
  serviceFixed: number
  tip: number
  /**
   * Contact who fronted the tip. `null`/undefined = the creator paid it
   * (default) — every participant owes their equal tip share as usual. A
   * non-creator here is credited the full tip: their owed total drops by it,
   * while the tip is still divided equally across everyone's breakdown.
   */
  tipPaidByContactId?: string | null
}

export interface SettlementResult {
  shares: Map<string, number>
  subtotal: number
  total: number
}

/** One item line as it applies to a single participant. */
export interface BreakdownItem {
  name: string
  share: number
}

/** Full cost breakdown for one participant. */
export interface ParticipantBreakdown {
  items: BreakdownItem[]
  base: number // sum of this participant's item shares
  service: number // proportional + equal service charge
  tip: number // equal tip share
  tipPaid: number // full tip this participant fronted (credit); 0 unless they paid the tip
  total: number // to2(base + service + tip), less tipPaid if they fronted the tip
}

export interface BreakdownResult {
  perContact: Map<string, ParticipantBreakdown>
  subtotal: number
  total: number
}

/**
 * Truncate a money value to 2 decimals (floor at the cent). The tiny epsilon
 * absorbs binary-float dust — e.g. a true 33333.33 can land in a double as
 * 33333.3299999…, whose ×100 floors to the wrong cent — so the result is always
 * the correct 2-decimal value. Money here is non-negative.
 */
export function to2(n: number): number {
  return Math.floor(n * 100 + 1e-6) / 100
}

/**
 * Compute a per-participant cost breakdown: which items each person shared,
 * their portion of each, and their service/tip/total. Single source of truth —
 * `computeSettlement` derives its `shares` map from this, so per-person totals
 * here always equal the stored `bill_participants.amount`.
 *
 * Every money result is truncated to 2 decimals (`to2`). Shares are kept equal
 * for equal sharers and are never nudged; the bill `total` holds the true
 * aggregate, so `total − Σ(shares)` is a small (≥ 0) "remembered" remainder.
 */
export function computeBreakdown(spec: BillSpec): BreakdownResult {
  const perContact = new Map<string, ParticipantBreakdown>()
  const ensure = (id: string): ParticipantBreakdown => {
    let p = perContact.get(id)
    if (!p) {
      p = { items: [], base: 0, service: 0, tip: 0, tipPaid: 0, total: 0 }
      perContact.set(id, p)
    }
    return p
  }

  // Phase 1: split each item equally among its sharers, truncated to 2 decimals.
  // `subtotal` is the true sum of item prices (not the truncated per-shares).
  let subtotal = 0
  for (const item of spec.items) {
    const count = item.shareContactIds.length
    if (count === 0) continue
    subtotal = to2(subtotal + item.price)
    const perShare = to2(item.price / count)
    for (const contactId of item.shareContactIds) {
      const p = ensure(contactId)
      p.items.push({ name: item.name ?? '', share: perShare })
      p.base = to2(p.base + perShare)
    }
  }

  const participantCount = perContact.size

  // Phase 2: add service + tip per participant, each truncated to 2 decimals.
  for (const p of perContact.values()) {
    const serviceProportional = to2((p.base * spec.servicePct) / 100)
    const serviceEqual = participantCount > 0 ? to2(spec.serviceFixed / participantCount) : 0
    const tipShare = participantCount > 0 ? to2(spec.tip / participantCount) : 0
    p.service = to2(serviceProportional + serviceEqual)
    p.tip = tipShare
    p.total = to2(p.base + p.service + p.tip)
  }

  // True grand total. Per-person truncation means Σ(shares) ≤ total; the
  // difference is carried here rather than nudged onto any one participant.
  const total = to2(
    subtotal + to2((subtotal * spec.servicePct) / 100) + spec.serviceFixed + spec.tip
  )

  // Credit the tip payer: the tip is still split equally above, but whoever
  // fronted it owes the full amount less (their total may go negative — the
  // group then owes them). No-op for the creator (caller passes null) or a
  // payer with no item shares (absent from perContact). The bill `total` is
  // unchanged — the credit only redistributes who owes what.
  if (spec.tipPaidByContactId) {
    const payer = perContact.get(spec.tipPaidByContactId)
    if (payer) {
      payer.tipPaid = spec.tip
      // Both operands are exact 2-decimal values; round to the cent (not floor,
      // which would mis-handle a negative credit) to clear float dust.
      payer.total = Math.round((payer.total - spec.tip) * 100) / 100
    }
  }

  return { perContact, subtotal, total }
}

export function computeSettlement(spec: BillSpec): SettlementResult {
  const { perContact, subtotal, total } = computeBreakdown(spec)
  const shares = new Map<string, number>()
  for (const [contactId, p] of perContact) {
    shares.set(contactId, p.total)
  }
  return { shares, subtotal, total }
}
