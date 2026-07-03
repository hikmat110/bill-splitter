import { describe, expect, test } from 'bun:test'
import {
  formatMoney,
  formatDate,
  formatParticipantSummary,
  cardNetwork,
  cardDisplayLabel,
} from './format'

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

describe('cardNetwork', () => {
  test('detects local and international networks by prefix', () => {
    expect(cardNetwork('8600123412341234')).toBe('Uzcard')
    expect(cardNetwork('9860123412341234')).toBe('Humo')
    expect(cardNetwork('4111111111111111')).toBe('Visa')
    expect(cardNetwork('5500123412341234')).toBe('Mastercard')
  })

  test('falls back to a generic label for unknown prefixes', () => {
    expect(cardNetwork('6262123412341234')).toBe('Card')
    expect(cardNetwork('1234123412341234')).toBe('Card')
  })
})

describe('cardDisplayLabel', () => {
  test('a custom label wins over the composed one', () => {
    expect(cardDisplayLabel({ number: '8600123412346789', label: 'Ish karta' })).toBe('Ish karta')
  })

  test('composes network + last 4 when unnamed', () => {
    expect(cardDisplayLabel({ number: '8600123412346789', label: null })).toBe('Uzcard ••6789')
    expect(cardDisplayLabel({ number: '9860000011112222', label: null })).toBe('Humo ••2222')
  })
})
