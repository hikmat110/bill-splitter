import { describe, expect, test } from 'bun:test'
import { computeSettlement, computeBreakdown, round100 } from './settlement'
import type { BillSpec } from './settlement'

// Helper: assert sum of shares equals total
function assertSumEqualsTotal(result: ReturnType<typeof computeSettlement>) {
  const sum = [...result.shares.values()].reduce((a, b) => a + b, 0n)
  expect(sum).toBe(result.total)
}

describe('round100', () => {
  test('rounds up at exactly 50', () => {
    expect(round100(150n)).toBe(200n)
    expect(round100(250n)).toBe(300n)
  })

  test('rounds down below 50', () => {
    expect(round100(149n)).toBe(100n)
    expect(round100(249n)).toBe(200n)
  })

  test('exact multiples of 100 unchanged', () => {
    expect(round100(1000n)).toBe(1000n)
    expect(round100(0n)).toBe(0n)
  })
})

describe('computeSettlement', () => {
  test('even 2-way split, no service or tip', () => {
    const spec: BillSpec = {
      items: [{ price: 200_000n, shareContactIds: ['A', 'B'] }],
      servicePct: 0,
      serviceFixed: 0n,
      tip: 0n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')).toBe(100_000n)
    expect(result.shares.get('B')).toBe(100_000n)
  })

  test('3-way split with rounding — sum still equals total', () => {
    // 100_000 / 3 = 33_333 remainder 1
    const spec: BillSpec = {
      items: [{ price: 100_000n, shareContactIds: ['A', 'B', 'C'] }],
      servicePct: 0,
      serviceFixed: 0n,
      tip: 0n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
  })

  test('zero service and tip — total equals subtotal rounded', () => {
    const spec: BillSpec = {
      items: [{ price: 150_000n, shareContactIds: ['A', 'B'] }],
      servicePct: 0,
      serviceFixed: 0n,
      tip: 0n,
    }
    const result = computeSettlement(spec)
    expect(result.total).toBe(result.subtotal)
    assertSumEqualsTotal(result)
  })

  test('10% service applied proportionally to item amounts', () => {
    // A ordered 100k, B ordered 50k → A should pay more service
    const spec: BillSpec = {
      items: [
        { price: 100_000n, shareContactIds: ['A'] },
        { price: 50_000n, shareContactIds: ['B'] },
      ],
      servicePct: 10,
      serviceFixed: 0n,
      tip: 0n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.get('A')!).toBeGreaterThan(result.shares.get('B')!)
  })

  test('tip is split equally regardless of item amounts', () => {
    const spec: BillSpec = {
      items: [
        { price: 200_000n, shareContactIds: ['A'] },
        { price: 50_000n, shareContactIds: ['B'] },
      ],
      servicePct: 0,
      serviceFixed: 0n,
      tip: 20_000n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    // A base=200k, B base=50k. Tip 20k/2=10k each
    // A: round100(200000+10000)=210000, B: round100(50000+10000)=60000
    expect(result.shares.get('A')).toBe(210_000n)
    expect(result.shares.get('B')).toBe(60_000n)
  })

  test('single participant gets 100% of total', () => {
    const spec: BillSpec = {
      items: [{ price: 75_000n, shareContactIds: ['A'] }],
      servicePct: 10,
      serviceFixed: 0n,
      tip: 5_000n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    expect(result.shares.size).toBe(1)
  })

  test('fixed service charge split equally', () => {
    const spec: BillSpec = {
      items: [{ price: 100_000n, shareContactIds: ['A', 'B'] }],
      servicePct: 0,
      serviceFixed: 20_000n,
      tip: 0n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    // Each person pays 50k items + 10k fixed service = 60k
    expect(result.shares.get('A')).toBe(60_000n)
    expect(result.shares.get('B')).toBe(60_000n)
  })

  test('mixed shares — only sharers of an item pay for it', () => {
    const spec: BillSpec = {
      items: [
        { price: 60_000n, shareContactIds: ['A', 'B', 'C'] },
        { price: 40_000n, shareContactIds: ['A'] },
      ],
      servicePct: 0,
      serviceFixed: 0n,
      tip: 0n,
    }
    const result = computeSettlement(spec)
    assertSumEqualsTotal(result)
    // A: 20000 + 40000 = 60000, B: 20000, C: 20000
    expect(result.shares.get('A')).toBe(60_000n)
    expect(result.shares.get('B')).toBe(20_000n)
    expect(result.shares.get('C')).toBe(20_000n)
  })
})

describe('computeBreakdown', () => {
  test('per-participant total matches computeSettlement shares', () => {
    const spec: BillSpec = {
      items: [
        { name: 'Steak', price: 100_000n, shareContactIds: ['A'] },
        { name: 'Wine', price: 60_000n, shareContactIds: ['A', 'B', 'C'] },
        { name: 'Salad', price: 40_000n, shareContactIds: ['B'] },
      ],
      servicePct: 10,
      serviceFixed: 5_000n,
      tip: 9_000n,
    }
    const breakdown = computeBreakdown(spec)
    const settlement = computeSettlement(spec)
    for (const [id, p] of breakdown.perContact) {
      expect(p.total).toBe(settlement.shares.get(id)!)
    }
    expect(breakdown.subtotal).toBe(settlement.subtotal)
    expect(breakdown.total).toBe(settlement.total)
  })

  test('item shares sum to base, and totals sum to grand total', () => {
    const spec: BillSpec = {
      items: [
        { name: 'A', price: 100_000n, shareContactIds: ['A', 'B', 'C'] },
        { name: 'B', price: 33_333n, shareContactIds: ['A', 'B'] },
      ],
      servicePct: 12,
      serviceFixed: 0n,
      tip: 7_000n,
    }
    const { perContact, total } = computeBreakdown(spec)
    for (const p of perContact.values()) {
      const itemsSum = p.items.reduce((s, it) => s + it.share, 0n)
      expect(itemsSum).toBe(p.base)
    }
    const sumTotals = [...perContact.values()].reduce((s, p) => s + p.total, 0n)
    expect(sumTotals).toBe(total)
  })

  test('records the items each participant shared, with their portion', () => {
    const spec: BillSpec = {
      items: [
        { name: 'Pizza', price: 90_000n, shareContactIds: ['A', 'B', 'C'] },
        { name: 'Beer', price: 20_000n, shareContactIds: ['A'] },
      ],
      servicePct: 0,
      serviceFixed: 0n,
      tip: 0n,
    }
    const { perContact } = computeBreakdown(spec)
    const a = perContact.get('A')!
    expect(a.items).toEqual([
      { name: 'Pizza', share: 30_000n },
      { name: 'Beer', share: 20_000n },
    ])
    const b = perContact.get('B')!
    expect(b.items).toEqual([{ name: 'Pizza', share: 30_000n }])
  })
})
