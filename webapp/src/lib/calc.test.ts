import { describe, it, expect } from 'bun:test'
import { previewShares } from './calc'
import { emptyDraft } from './draft'
import type { DraftBill, DraftWho } from './draft'

function draft(partial: Partial<DraftBill>): DraftBill {
  return { ...emptyDraft(), ...partial }
}

function item(price: number, qty: number, who: DraftWho[]) {
  return { id: 'i1', name: 'Dish', price, qty, who }
}

const amounts = (rows: { id: string; amount: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r.amount]))

describe('previewShares', () => {
  it('splits the unassigned remainder only among sharers without explicit units', () => {
    // 4 people, 3 dishes at 69k: A and B take one each, C and D share the third.
    const d = draft({
      participantIds: ['A', 'B', 'C', 'D'],
      items: [
        item(69_000, 3, [
          { id: 'A', units: 1 },
          { id: 'B', units: 1 },
          { id: 'C', units: null },
          { id: 'D', units: null },
        ]),
      ],
    })
    expect(amounts(previewShares(d))).toEqual({ A: 69_000, B: 69_000, C: 34_500, D: 34_500 })
  })

  it('splits the whole line equally when nobody has explicit units', () => {
    const d = draft({
      participantIds: ['A', 'B'],
      items: [
        item(10_000, 3, [
          { id: 'A', units: null },
          { id: 'B', units: null },
        ]),
      ],
    })
    expect(amounts(previewShares(d))).toEqual({ A: 15_000, B: 15_000 })
  })

  it('falls back to all sharers when everyone is explicit but units are left over', () => {
    const d = draft({
      participantIds: ['A', 'B'],
      items: [
        item(10_000, 3, [
          { id: 'A', units: 1 },
          { id: 'B', units: 1 },
        ]),
      ],
    })
    expect(amounts(previewShares(d))).toEqual({ A: 15_000, B: 15_000 })
  })

  it('applies proportional service and equal tip on top of unit shares', () => {
    const d = draft({
      participantIds: ['A', 'B'],
      servicePct: 10,
      tip: 2_000,
      items: [
        item(10_000, 3, [
          { id: 'A', units: 2 },
          { id: 'B', units: null },
        ]),
      ],
    })
    // A: 20k + 2k service + 1k tip; B: 10k + 1k service + 1k tip.
    expect(amounts(previewShares(d))).toEqual({ A: 23_000, B: 12_000 })
  })
})
