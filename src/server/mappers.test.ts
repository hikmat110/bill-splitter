import { describe, it, expect } from 'bun:test'
import { toCreateBillInput } from './mappers'
import type { CreateBillBody } from './schemas'
import { computeSettlement, type ItemSpec } from '../utils/settlement'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const CREATOR = 'creator-user-id'

const body: CreateBillBody = {
  title: 'Dinner at Milano',
  participantContactIds: [P1, P2, P3],
  items: [
    { name: 'Pizza', price: 68000, shareContactIds: [P1, P2] },
    { name: 'Pasta', price: 96000, shareContactIds: [P1, P2, P3] },
    { name: 'Water', price: 12000, shareContactIds: [P1, P2, P3] },
  ],
  servicePct: 10,
  tip: 20000,
}

describe('toCreateBillInput', () => {
  it('maps title, creator, participants and adjustments', () => {
    const input = toCreateBillInput(body, CREATOR)
    expect(input.creatorId).toBe(CREATOR)
    expect(input.title).toBe('Dinner at Milano')
    expect(input.participantContactIds).toEqual([P1, P2, P3])
    expect(input.servicePct).toBe(10)
    expect(input.serviceFixed).toBe(0n)
    expect(input.tip).toBe(20000n)
  })

  it('defaults quantity to 1, assigns positions, and coerces price to bigint', () => {
    const input = toCreateBillInput(body, CREATOR)
    input.items.forEach((item, i) => {
      expect(item.quantity).toBe(1)
      expect(item.position).toBe(i)
      expect(typeof item.price).toBe('bigint')
    })
    expect(input.items[0]!.price).toBe(68000n)
  })

  it('filters item sharers down to the participant set', () => {
    const withOutsider: CreateBillBody = {
      ...body,
      items: [{ name: 'Pizza', price: 1000, shareContactIds: [P1, 'not-a-participant'] }],
    }
    const input = toCreateBillInput(withOutsider, CREATOR)
    expect(input.items[0]!.shareContactIds).toEqual([P1])
  })

  it('defaults tip payer to null (creator paid) when absent', () => {
    expect(toCreateBillInput(body, CREATOR, P1).tipPaidByContactId).toBeNull()
  })

  it('normalizes the creator self-contact as tip payer to null', () => {
    const withSelf: CreateBillBody = { ...body, tipPaidByContactId: P1 }
    expect(toCreateBillInput(withSelf, CREATOR, P1).tipPaidByContactId).toBeNull()
  })

  it('keeps a non-creator participant as tip payer', () => {
    const withPayer: CreateBillBody = { ...body, tipPaidByContactId: P2 }
    expect(toCreateBillInput(withPayer, CREATOR, P1).tipPaidByContactId).toBe(P2)
  })

  it('drops a tip payer that is not a participant', () => {
    const withOutsider: CreateBillBody = { ...body, tipPaidByContactId: 'not-a-participant' }
    expect(toCreateBillInput(withOutsider, CREATOR, P1).tipPaidByContactId).toBeNull()
  })

  it('round-trips through computeSettlement: sum(shares) === total', () => {
    const input = toCreateBillInput(body, CREATOR)
    const items: ItemSpec[] = input.items.map((it) => ({
      price: it.price * BigInt(it.quantity),
      shareContactIds: it.shareContactIds,
    }))
    const settlement = computeSettlement({
      items,
      servicePct: input.servicePct,
      serviceFixed: input.serviceFixed,
      tip: input.tip,
    })
    const sum = [...settlement.shares.values()].reduce((a, b) => a + b, 0n)
    expect(sum).toBe(settlement.total)
  })
})
