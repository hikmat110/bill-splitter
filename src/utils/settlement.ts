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
  total: number // to2(base + service + tip)
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
      p = { items: [], base: 0, service: 0, tip: 0, total: 0 }
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
