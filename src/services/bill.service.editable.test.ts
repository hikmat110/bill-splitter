import { describe, expect, test } from 'bun:test'
import { isBillEditable } from './bill.service'

const CREATOR = 'creator-user-id'

function p(status: string, linkedUserId: string | null) {
  return { status, contact: { linked_user_id: linkedUserId } }
}

describe('isBillEditable', () => {
  test('editable when every non-creator participant is pending', () => {
    expect(
      isBillEditable([p('pending', 'u1'), p('pending', 'u2'), p('confirmed', CREATOR)], CREATOR)
    ).toBe(true)
  })

  test('locked when any non-creator participant marked paid', () => {
    expect(isBillEditable([p('pending', 'u1'), p('marked_paid', 'u2')], CREATOR)).toBe(false)
  })

  test('locked on confirmed or disputed', () => {
    expect(isBillEditable([p('confirmed', 'u1')], CREATOR)).toBe(false)
    expect(isBillEditable([p('disputed', 'u1')], CREATOR)).toBe(false)
  })

  test("creator's own self-participant never blocks editing", () => {
    // The self-participant is exempt regardless of its status.
    expect(isBillEditable([p('confirmed', CREATOR), p('pending', 'u1')], CREATOR)).toBe(true)
  })

  test('unlinked contacts (linked_user_id null) must still be pending', () => {
    expect(isBillEditable([p('pending', null)], CREATOR)).toBe(true)
    expect(isBillEditable([p('marked_paid', null)], CREATOR)).toBe(false)
  })

  test('empty participant list is trivially editable', () => {
    expect(isBillEditable([], CREATOR)).toBe(true)
  })
})
