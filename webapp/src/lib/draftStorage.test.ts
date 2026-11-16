import { describe, expect, test } from 'bun:test'
import { isDraftEmpty } from './draftStorage'
import { emptyDraft } from './draft'

const SELF = 'self-contact-id'
const FRIEND = 'friend-contact-id'

describe('isDraftEmpty', () => {
  test('a pristine draft is empty', () => {
    expect(isDraftEmpty(emptyDraft(), SELF)).toBe(true)
  })

  // The owner is pre-selected on every fresh draft. Counting them would make a
  // pristine draft look restorable: a phantom "draft restored" toast on open and
  // the welcome tour skipped for brand-new users.
  test('a draft holding only the pre-selected owner is empty', () => {
    expect(isDraftEmpty(emptyDraft(SELF), SELF)).toBe(true)
  })

  test('adding anyone else makes it non-empty', () => {
    const d = { ...emptyDraft(SELF), participantIds: [SELF, FRIEND] }
    expect(isDraftEmpty(d, SELF)).toBe(false)
  })

  test('a title, an item or a receipt alone makes it non-empty', () => {
    const base = emptyDraft(SELF)
    expect(isDraftEmpty({ ...base, title: 'Lunch' }, SELF)).toBe(false)
    expect(
      isDraftEmpty({ ...base, items: [{ id: 'i1', name: '', price: 0, qty: 1, who: [] }] }, SELF)
    ).toBe(false)
    expect(isDraftEmpty({ ...base, receiptAttachmentId: 'att-1' }, SELF)).toBe(false)
  })

  test('without a self id every participant counts (pre-existing behaviour)', () => {
    expect(isDraftEmpty({ ...emptyDraft(), participantIds: [SELF] })).toBe(false)
  })
})
