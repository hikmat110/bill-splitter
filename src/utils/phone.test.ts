import { describe, expect, test } from 'bun:test'
import { normalizePhone } from './phone'

describe('normalizePhone', () => {
  test('strips non-digits and prepends +', () => {
    expect(normalizePhone('998901234567')).toBe('+998901234567')
  })

  test('handles already-normalized E.164', () => {
    expect(normalizePhone('+998901234567')).toBe('+998901234567')
  })

  test('handles spaces and dashes', () => {
    expect(normalizePhone('+998 90 123-45-67')).toBe('+998901234567')
  })

  test('handles parentheses', () => {
    expect(normalizePhone('+998 (90) 123 45 67')).toBe('+998901234567')
  })
})
