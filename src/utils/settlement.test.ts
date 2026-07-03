import { describe, expect, test } from 'bun:test'
import { computeSettlement, computeBreakdown, to2 } from './settlement'
import type { BillSpec, ItemShare } from './settlement'

// Equal-split shares (no explicit units) — the legacy shape most tests use.
function eq(...contactIds: string[]): ItemShare[] {
  return contactIds.map((contactId) => ({ contactId, units: null }))
}

// Invariant: shares never collect MORE than the bill total, and the gap
// (the "remembered remainder" carried by `total`) is sub-som and ≥ 0.
function assertSumWithinTotal(result: ReturnType<typeof computeSettlement>) {
  const sum = [...result.shares.values()].reduce((a, b) => a + b, 0)
  expect(sum).toBeLessThanOrEqual(result.total + 1e-9)
  expect(result.total - sum).toBeGreaterThanOrEqual(-1e-9)
  expect(result.total - sum).toBeLessThan(1)
}

// Stronger form for clean even splits with no rounding remainder: shares sum
// to exactly the bill total (no leaked dust).
function assertSumEqualsTotal(result: ReturnType<typeof computeSettlement>) {
  const sum = [...result.shares.values()].reduce((a, b) => a + b, 0)
  expect(Math.abs(result.total - sum)).toBeLessThan(1e-9)
}

describe('to2', () => {
  test('truncates to 2 decimals (floors at the cent)', () => {
    expect(to2(33333.3333)).toBe(33333.33)
    expect(to2(0.6666)).toBe(0.66)
  })

  test('leaves clean 2-decimal values untouched, dust-guarded', () => {
    expect(to2(100000)).toBe(100000)
    expect(to2(10.33)).toBe(10.33)
    expect(to2(50000 / 1)).toBe(50000)
  })
})

describe('computeSettlement', () => {
  test('even 2-way split, no service or tip', () => {
    const spec: BillSpec = {
      items: [{ price: 200_000, shares: eq('A', 'B') }],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')).toBe(100_000)
    expect(result.shares.get('B')).toBe(100_000)
    expect(result.total).toBe(200_000)
  })

  test('3-way split keeps equal 2-decimal shares; the 0.01 lives in the total', () => {
    // 100_000 / 3 = 33_333.33 each → sum 99_999.99, total 100_000 (gap 0.01).
    const spec: BillSpec = {
      items: [{ price: 100_000, shares: eq('A', 'B', 'C') }],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')).toBeCloseTo(33_333.33, 2)
    expect(result.shares.get('B')).toBeCloseTo(33_333.33, 2)
    expect(result.shares.get('C')).toBeCloseTo(33_333.33, 2)
    const sum = [...result.shares.values()].reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(99_999.99, 2)
    expect(result.total).toBe(100_000)
    expect(result.total - sum).toBeCloseTo(0.01, 2)
  })

  test('decimal item price splits to the cent', () => {
    // 10.33 / 2 = 5.165 → truncated to 5.16 each; total keeps 10.33.
    const spec: BillSpec = {
      items: [{ price: 10.33, shares: eq('A', 'B') }],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')).toBeCloseTo(5.16, 2)
    expect(result.shares.get('B')).toBeCloseTo(5.16, 2)
    expect(result.total).toBe(10.33)
  })

  test('zero service and tip — total equals subtotal', () => {
    const spec: BillSpec = {
      items: [{ price: 150_000, shares: eq('A', 'B') }],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    expect(result.total).toBe(result.subtotal)
    assertSumWithinTotal(result)
  })

  test('10% service applied proportionally to item amounts', () => {
    const spec: BillSpec = {
      items: [
        { price: 100_000, shares: eq('A') },
        { price: 50_000, shares: eq('B') },
      ],
      servicePct: 10,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')!).toBeGreaterThan(result.shares.get('B')!)
  })

  test('tip is split equally regardless of item amounts', () => {
    const spec: BillSpec = {
      items: [
        { price: 200_000, shares: eq('A') },
        { price: 50_000, shares: eq('B') },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 20_000,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    // A base=200k, B base=50k. Tip 20k/2=10k each.
    expect(result.shares.get('A')).toBe(210_000)
    expect(result.shares.get('B')).toBe(60_000)
    expect(result.total).toBe(270_000)
  })

  test('single participant gets 100% of total', () => {
    const spec: BillSpec = {
      items: [{ price: 75_000, shares: eq('A') }],
      servicePct: 10,
      serviceFixed: 0,
      tip: 5_000,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.size).toBe(1)
    expect(result.shares.get('A')).toBe(87_500)
  })

  test('fixed service charge split equally', () => {
    const spec: BillSpec = {
      items: [{ price: 100_000, shares: eq('A', 'B') }],
      servicePct: 0,
      serviceFixed: 20_000,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')).toBe(60_000)
    expect(result.shares.get('B')).toBe(60_000)
  })

  test('mixed shares — only sharers of an item pay for it', () => {
    const spec: BillSpec = {
      items: [
        { price: 60_000, shares: eq('A', 'B', 'C') },
        { price: 40_000, shares: eq('A') },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')).toBe(60_000)
    expect(result.shares.get('B')).toBe(20_000)
    expect(result.shares.get('C')).toBe(20_000)
  })
})

describe('weighted units (quantity > 1)', () => {
  test('7 kebabs @ 10k: A ate 3, B ate 4', () => {
    const spec: BillSpec = {
      items: [
        {
          name: 'Kebab',
          price: 10_000,
          quantity: 7,
          shares: [
            { contactId: 'A', units: 3 },
            { contactId: 'B', units: 4 },
          ],
        },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(30_000)
    expect(result.shares.get('B')).toBe(40_000)
    expect(result.subtotal).toBe(70_000)
    expect(result.total).toBe(70_000)
  })

  test('partial assignment: unclaimed units split equally among all sharers', () => {
    // qty 7, A takes 3 explicitly; remainder 4 units (40k) splits across the
    // 3 sharers: 13_333.33 each (floored).
    const spec: BillSpec = {
      items: [
        {
          price: 10_000,
          quantity: 7,
          shares: [
            { contactId: 'A', units: 3 },
            { contactId: 'B', units: null },
            { contactId: 'C', units: null },
          ],
        },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumWithinTotal(result)
    expect(result.shares.get('A')).toBeCloseTo(43_333.33, 2)
    expect(result.shares.get('B')).toBeCloseTo(13_333.33, 2)
    expect(result.shares.get('C')).toBeCloseTo(13_333.33, 2)
    expect(result.total).toBe(70_000)
  })

  test('all-null units with quantity behaves as a plain equal split of the line total', () => {
    const weighted: BillSpec = {
      items: [{ price: 10_000, quantity: 6, shares: eq('A', 'B') }],
      servicePct: 12,
      serviceFixed: 0,
      tip: 5_000,
    }
    // Same bill expressed the legacy way: quantity folded into the price.
    const legacy: BillSpec = {
      items: [{ price: 60_000, shares: eq('A', 'B') }],
      servicePct: 12,
      serviceFixed: 0,
      tip: 5_000,
    }
    const w = computeSettlement(weighted)
    const l = computeSettlement(legacy)
    expect(w.subtotal).toBe(l.subtotal)
    expect(w.total).toBe(l.total)
    expect(w.shares.get('A')).toBe(l.shares.get('A')!)
    expect(w.shares.get('B')).toBe(l.shares.get('B')!)
  })

  test('units summing exactly to quantity leaves no remainder', () => {
    const spec: BillSpec = {
      items: [
        {
          price: 7_500,
          quantity: 4,
          shares: [
            { contactId: 'A', units: 1 },
            { contactId: 'B', units: 3 },
          ],
        },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(7_500)
    expect(result.shares.get('B')).toBe(22_500)
  })

  test('sharer with no units still shares tip and fixed service equally', () => {
    const spec: BillSpec = {
      items: [
        {
          price: 10_000,
          quantity: 2,
          shares: [
            { contactId: 'A', units: 2 },
            { contactId: 'B', units: null },
          ],
        },
      ],
      servicePct: 0,
      serviceFixed: 10_000,
      tip: 6_000,
    }
    // A: 20k items + 5k service + 3k tip; B: 0 items + 5k + 3k.
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(28_000)
    expect(result.shares.get('B')).toBe(8_000)
  })

  test('quantity 1 with explicit units is equivalent to a sole sharer', () => {
    const spec: BillSpec = {
      items: [{ price: 12_000, quantity: 1, shares: [{ contactId: 'A', units: 1 }] }],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    expect(result.shares.get('A')).toBe(12_000)
    expect(result.total).toBe(12_000)
  })

  test('service % stays proportional to weighted bases', () => {
    const spec: BillSpec = {
      items: [
        {
          price: 10_000,
          quantity: 10,
          shares: [
            { contactId: 'A', units: 8 },
            { contactId: 'B', units: 2 },
          ],
        },
      ],
      servicePct: 10,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(88_000) // 80k + 10%
    expect(result.shares.get('B')).toBe(22_000) // 20k + 10%
    expect(result.total).toBe(110_000)
  })

  test('breakdown records explicit units on multi-unit items only', () => {
    const spec: BillSpec = {
      items: [
        {
          name: 'Kebab',
          price: 10_000,
          quantity: 7,
          shares: [
            { contactId: 'A', units: 3 },
            { contactId: 'B', units: null },
          ],
        },
        { name: 'Salad', price: 20_000, shares: eq('A', 'B') },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const { perContact } = computeBreakdown(spec)
    const a = perContact.get('A')!
    expect(a.items[0]).toEqual({ name: 'Kebab', share: 50_000, units: 3 })
    expect(a.items[1]).toEqual({ name: 'Salad', share: 10_000 })
    const b = perContact.get('B')!
    expect(b.items[0]).toEqual({ name: 'Kebab', share: 20_000 })
  })

  test('defensive clamp: units above quantity never produce a negative remainder', () => {
    // Callers validate Σunits ≤ qty; if a bad payload slips through, the
    // remainder clamps to 0 instead of crediting anyone.
    const spec: BillSpec = {
      items: [
        {
          price: 10_000,
          quantity: 2,
          shares: [
            { contactId: 'A', units: 3 },
            { contactId: 'B', units: null },
          ],
        },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const result = computeSettlement(spec)
    expect(result.shares.get('A')).toBe(30_000)
    expect(result.shares.get('B')).toBe(0)
    expect(result.subtotal).toBe(20_000)
  })
})

describe('tip payer credit', () => {
  // 3-way even split of 300k + 30k tip; tip split equally is 10k each.
  const base3: BillSpec = {
    items: [{ price: 300_000, shares: eq('A', 'B', 'C') }],
    servicePct: 0,
    serviceFixed: 0,
    tip: 30_000,
  }

  test('null payer (creator default) is unchanged — sum equals total', () => {
    const result = computeSettlement({ ...base3, tipPaidByContactId: null })
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(110_000)
    expect(result.shares.get('B')).toBe(110_000)
    expect(result.shares.get('C')).toBe(110_000)
  })

  test('non-creator payer is credited the full tip; others unchanged', () => {
    const result = computeSettlement({ ...base3, tipPaidByContactId: 'B' })
    // B fronted the 30k tip: 110k fair share − 30k = 80k owed.
    expect(result.shares.get('A')).toBe(110_000)
    expect(result.shares.get('B')).toBe(80_000)
    expect(result.shares.get('C')).toBe(110_000)
    // Owed amounts now sum to total − tip (creator only fronted total − tip).
    const sum = [...result.shares.values()].reduce((a, b) => a + b, 0)
    expect(sum).toBe(result.total - base3.tip)
    expect(result.total).toBe(330_000)
  })

  test('breakdown carries the credit on tipPaid and equal tip share on tip', () => {
    const { perContact } = computeBreakdown({ ...base3, tipPaidByContactId: 'B' })
    const b = perContact.get('B')!
    expect(b.tip).toBe(10_000) // still owes an equal tip share
    expect(b.tipPaid).toBe(30_000) // credited the full tip they fronted
    expect(b.total).toBe(80_000)
    const a = perContact.get('A')!
    expect(a.tipPaid).toBe(0)
  })

  test('payer not among item sharers is a no-op (no row to credit)', () => {
    const result = computeSettlement({ ...base3, tipPaidByContactId: 'Z' })
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(110_000)
  })

  test('zero tip with a payer set credits nothing', () => {
    const spec: BillSpec = {
      items: [{ price: 300_000, shares: eq('A', 'B', 'C') }],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
      tipPaidByContactId: 'B',
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('B')).toBe(100_000)
  })
})

describe('computeBreakdown', () => {
  test('per-participant total matches computeSettlement shares', () => {
    const spec: BillSpec = {
      items: [
        { name: 'Steak', price: 100_000, shares: eq('A') },
        { name: 'Wine', price: 60_000, shares: eq('A', 'B', 'C') },
        { name: 'Salad', price: 40_000, shares: eq('B') },
      ],
      servicePct: 10,
      serviceFixed: 5_000,
      tip: 9_000,
    }
    const breakdown = computeBreakdown(spec)
    const settlement = computeSettlement(spec)
    for (const [id, p] of breakdown.perContact) {
      expect(p.total).toBe(settlement.shares.get(id)!)
    }
    expect(breakdown.subtotal).toBe(settlement.subtotal)
    expect(breakdown.total).toBe(settlement.total)
  })

  test('item shares sum to base, and totals sum to at most the grand total', () => {
    const spec: BillSpec = {
      items: [
        { name: 'A', price: 100_000, shares: eq('A', 'B', 'C') },
        { name: 'B', price: 33_333, shares: eq('A', 'B') },
      ],
      servicePct: 12,
      serviceFixed: 0,
      tip: 7_000,
    }
    const { perContact, total } = computeBreakdown(spec)
    for (const p of perContact.values()) {
      const itemsSum = p.items.reduce((s, it) => s + it.share, 0)
      expect(itemsSum).toBeCloseTo(p.base, 2)
    }
    const sumTotals = [...perContact.values()].reduce((s, p) => s + p.total, 0)
    expect(sumTotals).toBeLessThanOrEqual(total + 1e-9)
  })

  test('records the items each participant shared, with their portion', () => {
    const spec: BillSpec = {
      items: [
        { name: 'Pizza', price: 90_000, shares: eq('A', 'B', 'C') },
        { name: 'Beer', price: 20_000, shares: eq('A') },
      ],
      servicePct: 0,
      serviceFixed: 0,
      tip: 0,
    }
    const { perContact } = computeBreakdown(spec)
    const a = perContact.get('A')!
    expect(a.items).toEqual([
      { name: 'Pizza', share: 30_000 },
      { name: 'Beer', share: 20_000 },
    ])
    const b = perContact.get('B')!
    expect(b.items).toEqual([{ name: 'Pizza', share: 30_000 }])
  })
})
