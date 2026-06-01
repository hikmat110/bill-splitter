export interface ItemSpec {
  price: bigint
  shareContactIds: string[]
}

export interface BillSpec {
  items: ItemSpec[]
  servicePct: number
  serviceFixed: bigint
  tip: bigint
}

export interface SettlementResult {
  shares: Map<string, bigint>
  subtotal: bigint
  total: bigint
}

export function round100(amount: bigint): bigint {
  return ((amount + 50n) / 100n) * 100n
}

export function computeSettlement(spec: BillSpec): SettlementResult {
  const itemTotals = new Map<string, bigint>()

  // Phase 1: allocate item costs proportionally via integer division
  for (const item of spec.items) {
    const count = BigInt(item.shareContactIds.length)
    const perShare = item.price / count
    for (const contactId of item.shareContactIds) {
      itemTotals.set(contactId, (itemTotals.get(contactId) ?? 0n) + perShare)
    }
  }

  const subtotal = [...itemTotals.values()].reduce((a, b) => a + b, 0n)
  const participantCount = BigInt(itemTotals.size)

  // servicePct is e.g. 10 for 10%; scale by 100 to avoid floats entirely
  const servicePctScaled = BigInt(Math.round(spec.servicePct * 100))

  // Phase 2: add service + tip per participant, round each to 100 som
  const finalShares = new Map<string, bigint>()
  for (const [contactId, base] of itemTotals) {
    const serviceProportional = (base * servicePctScaled) / 10000n
    const serviceEqual = spec.serviceFixed / participantCount
    const tipShare = spec.tip / participantCount
    finalShares.set(contactId, round100(base + serviceProportional + serviceEqual + tipShare))
  }

  // Compute expected grand total using same rounding logic applied to the whole
  const grandTotal =
    round100(subtotal + (subtotal * servicePctScaled) / 10000n) +
    spec.serviceFixed +
    spec.tip

  // Reconcile: difference from per-person rounding goes to the largest payer
  const sumShares = [...finalShares.values()].reduce((a, b) => a + b, 0n)
  const diff = grandTotal - sumShares
  if (diff !== 0n) {
    let largestId = ''
    let largestAmt = -1n
    for (const [id, amt] of finalShares) {
      if (amt > largestAmt) {
        largestAmt = amt
        largestId = id
      }
    }
    if (largestId) {
      finalShares.set(largestId, finalShares.get(largestId)! + diff)
    }
  }

  return { shares: finalShares, subtotal, total: grandTotal }
}
