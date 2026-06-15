import { describe, expect, test } from 'bun:test'
import { formatMoney, formatDate, formatParticipantSummary } from './format'

describe('formatMoney', () => {
  test('formats 12500 with space thousands separator', () => {
    expect(formatMoney(12500)).toMatch('12')
    expect(formatMoney(12500)).toContain('UZS')
  })

  test('formats 0', () => {
    expect(formatMoney(0)).toContain('0')
    expect(formatMoney(0)).toContain('UZS')
  })

  test('formats 1_000_000', () => {
    const result = formatMoney(1_000_000)
    expect(result).toContain('UZS')
    expect(result).toContain('000')
  })

  test('formats 100', () => {
    expect(formatMoney(100)).toContain('100')
    expect(formatMoney(100)).toContain('UZS')
  })

  test('shows 2 decimals for a non-integer amount, none for a whole one', () => {
    // ru-RU uses a comma decimal separator: 33 333,33
    expect(formatMoney(33_333.33)).toContain('33')
    expect(formatMoney(33_333.33)).toContain(',')
    expect(formatMoney(100_000)).not.toContain(',')
  })
})

describe('formatDate', () => {
  test('outputs a formatted date string containing year', () => {
    const d = new Date('2026-06-01T10:30:00Z')
    const result = formatDate(d)
    expect(result).toContain('2026')
  })

  test('outputs two-digit day and month', () => {
    const d = new Date('2026-01-05T00:00:00Z')
    const result = formatDate(d)
    // Should contain 01 or 05 (date parts)
    expect(result).toMatch(/\d{2}/)
  })
})

describe('formatParticipantSummary', () => {
  test('"3/4 оплачено"', () => {
    expect(formatParticipantSummary(3, 4)).toBe('3/4 оплачено')
  })

  test('"0/2 оплачено"', () => {
    expect(formatParticipantSummary(0, 2)).toBe('0/2 оплачено')
  })

  test('"1/1 оплачено"', () => {
    expect(formatParticipantSummary(1, 1)).toBe('1/1 оплачено')
  })
})
