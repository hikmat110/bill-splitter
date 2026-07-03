import { describe, it, expect } from 'bun:test'
import { toCreateBillInput } from './mappers'
import { createBillSchema } from './schemas'
import { computeSettlement, type ItemSpec } from '../utils/settlement'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const CREATOR = 'creator-user-id'

// Fixtures go through the schema, exactly like routes do — so these tests also
// catch the mapper's input shape drifting from the schema's output.
const body = createBillSchema.parse({
  title: 'Dinner at Milano',
  participantContactIds: [P1, P2, P3],
  items: [
    { name: 'Pizza', price: 68000, shareContactIds: [P1, P2] },
    { name: 'Pasta', price: 96000, shareContactIds: [P1, P2, P3] },
    { name: 'Water', price: 12000, shareContactIds: [P1, P2, P3] },
  ],
  servicePct: 10,
  tip: 20000,
})

describe('toCreateBillInput', () => {
  it('maps title, creator, participants and adjustments', () => {
    const input = toCreateBillInput(body, CREATOR)
    expect(input.creatorId).toBe(CREATOR)
    expect(input.title).toBe('Dinner at Milano')
    expect(input.participantContactIds).toEqual([P1, P2, P3])
    expect(input.servicePct).toBe(10)
    expect(input.serviceFixed).toBe(0)
    expect(input.tip).toBe(20000)
  })

  it('defaults quantity to 1, assigns positions, and keeps price as a number', () => {
    const input = toCreateBillInput(body, CREATOR)
    input.items.forEach((item, i) => {
      expect(item.quantity).toBe(1)
      expect(item.position).toBe(i)
      expect(typeof item.price).toBe('number')
    })
    expect(input.items[0]!.price).toBe(68000)
  })

  it('passes an explicit quantity through and maps units per sharer', () => {
    const withUnits = createBillSchema.parse({
      title: 'Kebabs',
      participantContactIds: [P1, P2],
      items: [
        {
          name: 'Kebab',
          price: 10000,
          quantity: 7,
          shareContactIds: [P1, P2],
          unitsByContactId: { [P1]: 3, [P2]: 4 },
        },
      ],
    })
    const input = toCreateBillInput(withUnits, CREATOR)
    expect(input.items[0]!.quantity).toBe(7)
    expect(input.items[0]!.shares).toEqual([
      { contactId: P1, units: 3 },
      { contactId: P2, units: 4 },
    ])
  })

  it('maps sharers without explicit units to null units', () => {
    const partial = createBillSchema.parse({
      title: 'Kebabs',
      participantContactIds: [P1, P2],
      items: [
        {
          name: 'Kebab',
          price: 10000,
          quantity: 7,
          shareContactIds: [P1, P2],
          unitsByContactId: { [P1]: 3 },
        },
      ],
    })
    const input = toCreateBillInput(partial, CREATOR)
    expect(input.items[0]!.shares).toEqual([
      { contactId: P1, units: 3 },
      { contactId: P2, units: null },
    ])
  })

  it('passes decimal prices through unchanged', () => {
    const decimalBody = createBillSchema.parse({
      title: 'Coffee run',
      participantContactIds: [P1, P2],
      items: [{ name: 'Coffee', price: 10.33, shareContactIds: [P1, P2] }],
    })
    const input = toCreateBillInput(decimalBody, CREATOR)
    expect(input.items[0]!.price).toBe(10.33)
  })

  it('filters item sharers down to the participant set', () => {
    // The schema rejects outsiders, so exercise the mapper's defensive filter
    // directly with a hand-built body (bypassing parse).
    const withOutsider = {
      ...body,
      items: [
        {
          name: 'Pizza',
          price: 1000,
          quantity: 1,
          shareContactIds: [P1, 'not-a-participant'],
        },
      ],
    }
    const input = toCreateBillInput(withOutsider, CREATOR)
    expect(input.items[0]!.shares).toEqual([{ contactId: P1, units: null }])
  })

  it('defaults tip payer to null (creator paid) when absent', () => {
    expect(toCreateBillInput(body, CREATOR, P1).tipPaidByContactId).toBeNull()
  })

  it('normalizes the creator self-contact as tip payer to null', () => {
    const withSelf = { ...body, tipPaidByContactId: P1 }
    expect(toCreateBillInput(withSelf, CREATOR, P1).tipPaidByContactId).toBeNull()
  })

  it('keeps a non-creator participant as tip payer', () => {
    const withPayer = { ...body, tipPaidByContactId: P2 }
    expect(toCreateBillInput(withPayer, CREATOR, P1).tipPaidByContactId).toBe(P2)
  })

  it('drops a tip payer that is not a participant', () => {
    const withOutsider = { ...body, tipPaidByContactId: 'not-a-participant' }
    expect(toCreateBillInput(withOutsider, CREATOR, P1).tipPaidByContactId).toBeNull()
  })

  it('threads the route-resolved cardId; absent means none', () => {
    const CARD = '99999999-9999-4999-8999-999999999999'
    expect(toCreateBillInput(body, CREATOR, P1, CARD).cardId).toBe(CARD)
    expect(toCreateBillInput(body, CREATOR, P1, null).cardId).toBeNull()
    expect(toCreateBillInput(body, CREATOR, P1).cardId).toBeNull()
  })

  it('round-trips through computeSettlement: sum(shares) ≤ total', () => {
    const input = toCreateBillInput(body, CREATOR)
    const items: ItemSpec[] = input.items.map((it) => ({
      price: it.price,
      quantity: it.quantity,
      shares: it.shares,
    }))
    const settlement = computeSettlement({
      items,
      servicePct: input.servicePct,
      serviceFixed: input.serviceFixed,
      tip: input.tip,
    })
    const sum = [...settlement.shares.values()].reduce((a, b) => a + b, 0)
    // Shares never collect more than the total; the small remainder is carried
    // by `total` rather than nudged onto a participant.
    expect(sum).toBeLessThanOrEqual(settlement.total + 1e-9)
    expect(settlement.total - sum).toBeLessThan(1)
  })
})
