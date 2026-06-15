import { describe, it, expect } from 'bun:test'
import { money } from './currency'

describe('money', () => {
  it('groups thousands and appends the so\'m suffix', () => {
    expect(money(68000)).toBe("68,000 so'm")
    expect(money(1234567)).toBe("1,234,567 so'm")
  })

  it('formats zero', () => {
    expect(money(0)).toBe("0 so'm")
  })

  it('shows up to 2 decimals for non-integer amounts', () => {
    expect(money(33333.33)).toBe("33,333.33 so'm")
    expect(money(68000.6)).toBe("68,000.6 so'm")
  })

  it('shows a sign only when requested', () => {
    expect(money(5000, { signed: true })).toBe("+5,000 so'm")
    expect(money(-5000, { signed: true })).toBe("−5,000 so'm")
    expect(money(-5000)).toBe("5,000 so'm")
  })
})
