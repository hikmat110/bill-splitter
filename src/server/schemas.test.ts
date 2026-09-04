import { describe, it, expect } from 'bun:test'
import {
  createBillSchema,
  createCardSchema,
  updateCardSchema,
  updateMeSchema,
  createContactSchema,
  addContactsByUsernameSchema,
  createFeedbackSchema,
  updateFeedbackSchema,
  adminMessageSchema,
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

  it('accepts cardId as uuid, null, or absent; rejects a non-uuid', () => {
    expect(createBillSchema.safeParse({ ...validBill, cardId: P1 }).success).toBe(true)
    expect(createBillSchema.safeParse({ ...validBill, cardId: null }).success).toBe(true)
    expect(createBillSchema.safeParse(validBill).success).toBe(true)
    expect(createBillSchema.safeParse({ ...validBill, cardId: 'not-a-uuid' }).success).toBe(false)
    // Absent stays undefined — the server resolves it to the default card.
    expect(createBillSchema.parse(validBill).cardId).toBeUndefined()
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

describe('createCardSchema', () => {
  it('accepts a 16-digit number, including spaced or dashed input', () => {
    expect(createCardSchema.safeParse({ number: '8600123412341234' }).success).toBe(true)
    expect(createCardSchema.safeParse({ number: '8600 1234 1234 1234' }).success).toBe(true)
    expect(createCardSchema.safeParse({ number: '8600-1234-1234-1234' }).success).toBe(true)
  })

  it('rejects 15 or 17 digits', () => {
    expect(createCardSchema.safeParse({ number: '860012341234123' }).success).toBe(false)
    expect(createCardSchema.safeParse({ number: '86001234123412345' }).success).toBe(false)
  })

  it('bounds the optional label to 1–50 characters', () => {
    expect(createCardSchema.safeParse({ number: '8600123412341234', label: 'Ish' }).success).toBe(true)
    expect(createCardSchema.safeParse({ number: '8600123412341234', label: '   ' }).success).toBe(false)
    expect(
      createCardSchema.safeParse({ number: '8600123412341234', label: 'x'.repeat(51) }).success
    ).toBe(false)
  })
})

describe('updateCardSchema', () => {
  it('accepts a rename, a clear, a set-default, or both together', () => {
    expect(updateCardSchema.safeParse({ label: 'Ish karta' }).success).toBe(true)
    expect(updateCardSchema.safeParse({ label: null }).success).toBe(true)
    expect(updateCardSchema.safeParse({ isDefault: true }).success).toBe(true)
    expect(updateCardSchema.safeParse({ label: 'X', isDefault: true }).success).toBe(true)
  })

  it('rejects an empty body, isDefault:false, and bad labels', () => {
    expect(updateCardSchema.safeParse({}).success).toBe(false)
    expect(updateCardSchema.safeParse({ isDefault: false }).success).toBe(false)
    expect(updateCardSchema.safeParse({ label: '   ' }).success).toBe(false)
    expect(updateCardSchema.safeParse({ label: 'x'.repeat(51) }).success).toBe(false)
  })
})

describe('updateMeSchema', () => {
  it('accepts the supported language codes only', () => {
    expect(updateMeSchema.safeParse({ languageCode: 'uz' }).success).toBe(true)
    expect(updateMeSchema.safeParse({ languageCode: 'ru' }).success).toBe(true)
    expect(updateMeSchema.safeParse({ languageCode: 'en' }).success).toBe(true)
    expect(updateMeSchema.safeParse({ languageCode: 'de' }).success).toBe(false)
    expect(updateMeSchema.safeParse({}).success).toBe(false)
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

describe('createFeedbackSchema', () => {
  const context = {
    screen: 'bill_detail',
    buildId: '0.1.0+64070b7',
    platform: 'ios',
    tgVersion: '8.0',
    language: 'ru',
  }
  const shot = (isAutoCapture = false) => ({
    attachmentId: P1,
    mime: 'image/jpeg',
    isAutoCapture,
  })

  it('accepts a minimal submission (attachments default to [])', () => {
    const parsed = createFeedbackSchema.parse({
      category: 'bug',
      message: 'Broken total',
      context,
    })
    expect(parsed.attachments).toEqual([])
  })

  it('accepts attachments with at most one auto-capture', () => {
    expect(
      createFeedbackSchema.safeParse({
        category: 'suggestion',
        message: 'Add dark mode',
        attachments: [shot(true), shot()],
        context,
      }).success
    ).toBe(true)
  })

  it('rejects an empty message and overlong message', () => {
    expect(
      createFeedbackSchema.safeParse({ category: 'bug', message: '   ', context }).success
    ).toBe(false)
    expect(
      createFeedbackSchema.safeParse({ category: 'bug', message: 'x'.repeat(2001), context })
        .success
    ).toBe(false)
  })

  it('rejects a bad category, bad mime, and more than 5 attachments', () => {
    expect(
      createFeedbackSchema.safeParse({ category: 'praise', message: 'hi', context }).success
    ).toBe(false)
    expect(
      createFeedbackSchema.safeParse({
        category: 'bug',
        message: 'hi',
        attachments: [{ attachmentId: P1, mime: 'image/gif' }],
        context,
      }).success
    ).toBe(false)
    expect(
      createFeedbackSchema.safeParse({
        category: 'bug',
        message: 'hi',
        attachments: Array.from({ length: 6 }, () => shot()),
        context,
      }).success
    ).toBe(false)
  })

  it('rejects two auto-captures', () => {
    expect(
      createFeedbackSchema.safeParse({
        category: 'bug',
        message: 'hi',
        attachments: [shot(true), shot(true)],
        context,
      }).success
    ).toBe(false)
  })
})

describe('updateFeedbackSchema', () => {
  it('accepts only the known statuses', () => {
    expect(updateFeedbackSchema.safeParse({ status: 'open' }).success).toBe(true)
    expect(updateFeedbackSchema.safeParse({ status: 'in_progress' }).success).toBe(true)
    expect(updateFeedbackSchema.safeParse({ status: 'resolved' }).success).toBe(true)
    expect(updateFeedbackSchema.safeParse({ status: 'closed' }).success).toBe(false)
    expect(updateFeedbackSchema.safeParse({}).success).toBe(false)
  })
})

describe('adminMessageSchema', () => {
  it('accepts trimmed non-empty text up to 4000 chars', () => {
    expect(adminMessageSchema.safeParse({ text: '  hello  ' }).success).toBe(true)
    expect(adminMessageSchema.safeParse({ text: 'x'.repeat(4000) }).success).toBe(true)
  })

  it('rejects empty, whitespace-only, and oversized text', () => {
    expect(adminMessageSchema.safeParse({ text: '' }).success).toBe(false)
    expect(adminMessageSchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(adminMessageSchema.safeParse({ text: 'x'.repeat(4001) }).success).toBe(false)
    expect(adminMessageSchema.safeParse({}).success).toBe(false)
  })
})
