import { describe, it, expect } from 'bun:test'
import {
  createBillSchema,
  createContactSchema,
  addContactsByUsernameSchema,
} from './schemas'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const OUTSIDER = '33333333-3333-4333-8333-333333333333'

const validBill = {
  title: 'Dinner',
  participantContactIds: [P1, P2],
  items: [{ name: 'Pizza', price: 68000, shareContactIds: [P1, P2] }],
  servicePct: 10,
  tip: 0,
}

describe('createBillSchema', () => {
  it('accepts a well-formed bill', () => {
    expect(createBillSchema.safeParse(validBill).success).toBe(true)
  })

  it('defaults servicePct and tip to 0', () => {
    const { servicePct, tip, ...rest } = validBill
    void servicePct
    void tip
    const parsed = createBillSchema.parse(rest)
    expect(parsed.servicePct).toBe(0)
    expect(parsed.tip).toBe(0)
  })

  it('rejects an empty items list', () => {
    expect(createBillSchema.safeParse({ ...validBill, items: [] }).success).toBe(false)
  })

  it('rejects an empty participant list', () => {
    expect(
      createBillSchema.safeParse({ ...validBill, participantContactIds: [] }).success
    ).toBe(false)
  })

  it('rejects a non-positive price', () => {
    const bad = { ...validBill, items: [{ name: 'X', price: 0, shareContactIds: [P1] }] }
    expect(createBillSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a negative tip', () => {
    expect(createBillSchema.safeParse({ ...validBill, tip: -100 }).success).toBe(false)
  })

  it('rejects servicePct out of range', () => {
    expect(createBillSchema.safeParse({ ...validBill, servicePct: 150 }).success).toBe(false)
  })

  it('rejects a missing title', () => {
    const { title, ...rest } = validBill
    void title
    expect(createBillSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an item shared with a non-participant', () => {
    const bad = {
      ...validBill,
      items: [{ name: 'Pizza', price: 1000, shareContactIds: [P1, OUTSIDER] }],
    }
    expect(createBillSchema.safeParse(bad).success).toBe(false)
  })

  it('defaults quantity to 1 for legacy item payloads', () => {
    const parsed = createBillSchema.parse(validBill)
    expect(parsed.items[0]!.quantity).toBe(1)
    expect(parsed.items[0]!.unitsByContactId).toBeUndefined()
  })

  it('accepts quantity with per-person units summing within it', () => {
    const withUnits = {
      ...validBill,
      items: [
        {
          name: 'Kebab',
          price: 10000,
          quantity: 7,
          shareContactIds: [P1, P2],
          unitsByContactId: { [P1]: 3, [P2]: 4 },
        },
      ],
    }
    expect(createBillSchema.safeParse(withUnits).success).toBe(true)
  })

  it('rejects units assigned to a non-sharer', () => {
    const bad = {
      ...validBill,
      items: [
        {
          name: 'Kebab',
          price: 10000,
          quantity: 7,
          shareContactIds: [P1],
          unitsByContactId: { [P2]: 2 },
        },
      ],
    }
    expect(createBillSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects units summing above the quantity', () => {
    const bad = {
      ...validBill,
      items: [
        {
          name: 'Kebab',
          price: 10000,
          quantity: 3,
          shareContactIds: [P1, P2],
          unitsByContactId: { [P1]: 2, [P2]: 2 },
        },
      ],
    }
    expect(createBillSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a non-integer or zero quantity', () => {
    const zero = {
      ...validBill,
      items: [{ name: 'X', price: 1000, quantity: 0, shareContactIds: [P1] }],
    }
    const frac = {
      ...validBill,
      items: [{ name: 'X', price: 1000, quantity: 1.5, shareContactIds: [P1] }],
    }
    expect(createBillSchema.safeParse(zero).success).toBe(false)
    expect(createBillSchema.safeParse(frac).success).toBe(false)
  })
})

describe('createContactSchema', () => {
  it('accepts a name with optional phone', () => {
    expect(createContactSchema.safeParse({ displayName: 'Bob', phone: '+998901112233' }).success).toBe(true)
    expect(createContactSchema.safeParse({ displayName: 'Bob' }).success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createContactSchema.safeParse({ displayName: '   ' }).success).toBe(false)
  })
})

describe('addContactsByUsernameSchema', () => {
  it('accepts a free-text usernames string', () => {
    expect(addContactsByUsernameSchema.safeParse({ usernames: '@alice, @bob' }).success).toBe(true)
  })

  it('rejects an empty/whitespace string', () => {
    expect(addContactsByUsernameSchema.safeParse({ usernames: '   ' }).success).toBe(false)
    expect(addContactsByUsernameSchema.safeParse({ usernames: '' }).success).toBe(false)
  })

  it('rejects an overly long string', () => {
    expect(addContactsByUsernameSchema.safeParse({ usernames: 'a'.repeat(501) }).success).toBe(false)
  })
})
