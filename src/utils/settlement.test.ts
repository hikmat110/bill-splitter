import { describe, expect, test } from 'bun:test'
import { computeSettlement, computeBreakdown, to2 } from './settlement'
import type { BillSpec } from './settlement'

// Invariant: shares never collect MORE than the bill total, and the gap
// (the "remembered remainder" carried by `total`) is sub-som and ≥ 0.
function assertSumWithinTotal(result: ReturnType<typeof computeSettlement>) {
  const sum = [...result.shares.values()].reduce((a, b) => a + b, 0)
  expect(sum).toBeLessThanOrEqual(result.total + 1e-9)
  expect(result.total - sum).toBeGreaterThanOrEqual(-1e-9)
  expect(result.total - sum).toBeLessThan(1)
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
      items: [{ price: 200_000, shareContactIds: ['A', 'B'] }],
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
      items: [{ price: 100_000, shareContactIds: ['A', 'B', 'C'] }],
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
      items: [{ price: 10.33, shareContactIds: ['A', 'B'] }],
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
      items: [{ price: 150_000, shareContactIds: ['A', 'B'] }],
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
        { price: 100_000, shareContactIds: ['A'] },
        { price: 50_000, shareContactIds: ['B'] },
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
        { price: 200_000, shareContactIds: ['A'] },
        { price: 50_000, shareContactIds: ['B'] },
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
      items: [{ price: 75_000, shareContactIds: ['A'] }],
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
      items: [{ price: 100_000, shareContactIds: ['A', 'B'] }],
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
        { price: 60_000, shareContactIds: ['A', 'B', 'C'] },
        { price: 40_000, shareContactIds: ['A'] },
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

describe('computeBreakdown', () => {
  test('per-participant total matches computeSettlement shares', () => {
    const spec: BillSpec = {
      items: [
        { name: 'Steak', price: 100_000, shareContactIds: ['A'] },
        { name: 'Wine', price: 60_000, shareContactIds: ['A', 'B', 'C'] },
        { name: 'Salad', price: 40_000, shareContactIds: ['B'] },
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
        { name: 'A', price: 100_000, shareContactIds: ['A', 'B', 'C'] },
        { name: 'B', price: 33_333, shareContactIds: ['A', 'B'] },
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
        { name: 'Pizza', price: 90_000, shareContactIds: ['A', 'B', 'C'] },
        { name: 'Beer', price: 20_000, shareContactIds: ['A'] },
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
