export interface ItemSpec {
  name?: string
  price: bigint
  shareContactIds: string[]
}

export interface BillSpec {
  items: ItemSpec[]
  servicePct: number
  serviceFixed: bigint
  tip: bigint
  /**
   * Contact who fronted the tip. `null`/undefined = the creator paid it
   * (default) — every participant owes their equal tip share as usual. A
   * non-creator here is credited the full tip: their owed total drops by it,
   * while the tip is still divided equally across everyone's breakdown.
   */
  tipPaidByContactId?: string | null
}

export interface SettlementResult {
  shares: Map<string, bigint>
  subtotal: bigint
  total: bigint
}

/** One item line as it applies to a single participant. */
export interface BreakdownItem {
  name: string
  share: bigint
}

/** Full cost breakdown for one participant. */
export interface ParticipantBreakdown {
  items: BreakdownItem[]
  base: bigint // sum of this participant's item shares
  service: bigint // proportional + equal service charge
  tip: bigint // equal tip share
  tipPaid: bigint // full tip this participant fronted (credit); 0 unless they paid the tip
  total: bigint // round100(base + service + tip) − tipPaid, incl. reconciliation diff
}

export interface BreakdownResult {
  perContact: Map<string, ParticipantBreakdown>
  subtotal: bigint
  total: bigint
}

export function round100(amount: bigint): bigint {
  return ((amount + 50n) / 100n) * 100n
}

/**
 * Compute a per-participant cost breakdown: which items each person shared,
 * their portion of each, and their service/tip/total. Single source of truth —
 * `computeSettlement` derives its `shares` map from this, so per-person totals
 * here always equal the stored `bill_participants.amount`.
 */
export function computeBreakdown(spec: BillSpec): BreakdownResult {
  const perContact = new Map<string, ParticipantBreakdown>()
  const ensure = (id: string): ParticipantBreakdown => {
    let p = perContact.get(id)
    if (!p) {
      p = { items: [], base: 0n, service: 0n, tip: 0n, tipPaid: 0n, total: 0n }
      perContact.set(id, p)
    }
    return p
  }

  // Phase 1: allocate item costs proportionally via integer division
  for (const item of spec.items) {
    const count = BigInt(item.shareContactIds.length)
    if (count === 0n) continue
    const perShare = item.price / count
    for (const contactId of item.shareContactIds) {
      const p = ensure(contactId)
      p.items.push({ name: item.name ?? '', share: perShare })
      p.base += perShare
    }
  }

  const subtotal = [...perContact.values()].reduce((a, p) => a + p.base, 0n)
  const participantCount = BigInt(perContact.size)

  // servicePct is e.g. 10 for 10%; scale by 100 to avoid floats entirely
  const servicePctScaled = BigInt(Math.round(spec.servicePct * 100))

  // Phase 2: add service + tip per participant, round each to 100 som
  for (const p of perContact.values()) {
    const serviceProportional = (p.base * servicePctScaled) / 10000n
    const serviceEqual = participantCount > 0n ? spec.serviceFixed / participantCount : 0n
    const tipShare = participantCount > 0n ? spec.tip / participantCount : 0n
    p.service = serviceProportional + serviceEqual
    p.tip = tipShare
    p.total = round100(p.base + p.service + p.tip)
  }

  // Compute expected grand total using same rounding logic applied to the whole
  const grandTotal =
    round100(subtotal + (subtotal * servicePctScaled) / 10000n) +
    spec.serviceFixed +
    spec.tip

  // Reconcile: difference from per-person rounding goes to the largest payer
  const sumShares = [...perContact.values()].reduce((a, p) => a + p.total, 0n)
  const diff = grandTotal - sumShares
  if (diff !== 0n) {
    let largest: ParticipantBreakdown | undefined
    let largestAmt = -1n
    for (const p of perContact.values()) {
      if (p.total > largestAmt) {
        largestAmt = p.total
        largest = p
      }
    }
    if (largest) {
      largest.total += diff
    }
  }

  // Credit the tip payer: the tip is still split equally above, but whoever
  // fronted it owes the full amount less. Applied after reconciliation so fair
  // shares (and the "largest payer" pick) are untouched. No-op for the creator
  // (caller passes null) or a payer with no item shares (absent from perContact).
  if (spec.tipPaidByContactId) {
    const payer = perContact.get(spec.tipPaidByContactId)
    if (payer) {
      payer.tipPaid = spec.tip
      payer.total -= spec.tip
    }
  }

  return { perContact, subtotal, total: grandTotal }
}

export function computeSettlement(spec: BillSpec): SettlementResult {
  const { perContact, subtotal, total } = computeBreakdown(spec)
  const shares = new Map<string, bigint>()
  for (const [contactId, p] of perContact) {
    shares.set(contactId, p.total)
  }
  return { shares, subtotal, total }
}
