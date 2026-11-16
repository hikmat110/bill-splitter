import { describe, it, expect } from 'bun:test'
import { amountText, amountValue, canonicalAmount, formatAmountInput } from './amount-input'

/** What the field shows after the user's keystroke lands in the formatted text. */
const type = (raw: string, opts?: { integer?: boolean }) =>
  formatAmountInput(canonicalAmount(raw, opts))

describe('canonicalAmount', () => {
  it('keeps digits and a single decimal point', () => {
    expect(canonicalAmount('68000')).toBe('68000')
    expect(canonicalAmount('12.5')).toBe('12.5')
    expect(canonicalAmount('12.50')).toBe('12.50')
    expect(canonicalAmount('1.2.3')).toBe('1.23')
  })

  it('treats commas as thousands separators, never as a decimal point', () => {
    expect(canonicalAmount('6,8000')).toBe('68000') // "6,800" + typed "0"
    expect(canonicalAmount('6,00')).toBe('600') // "6,800" with the 8 deleted
    expect(canonicalAmount('12,5')).toBe('125')
    expect(canonicalAmount('1,234,567')).toBe('1234567')
  })

  it('keeps a trailing dot so typing can continue', () => {
    expect(canonicalAmount('12.')).toBe('12.')
    expect(canonicalAmount('.')).toBe('0.')
    expect(canonicalAmount('.5')).toBe('0.5')
  })

  it('ignores a third decimal digit instead of reinterpreting it', () => {
    expect(canonicalAmount('12.505')).toBe('12.50')
    expect(canonicalAmount('0.999')).toBe('0.99')
  })

  it('strips leading zeros', () => {
    expect(canonicalAmount('007')).toBe('7')
    expect(canonicalAmount('00')).toBe('0')
    expect(canonicalAmount('00.5')).toBe('0.5')
    expect(canonicalAmount('0')).toBe('0')
  })

  it('returns empty for nothing numeric', () => {
    expect(canonicalAmount('')).toBe('')
    expect(canonicalAmount('abc')).toBe('')
    expect(canonicalAmount(',')).toBe('')
    expect(canonicalAmount('-')).toBe('')
  })

  it('drops the fraction in integer mode', () => {
    expect(canonicalAmount('12.5', { integer: true })).toBe('12')
    expect(canonicalAmount('12.', { integer: true })).toBe('12')
    expect(canonicalAmount('.', { integer: true })).toBe('')
  })
})

describe('formatAmountInput', () => {
  it('groups thousands with commas', () => {
    expect(formatAmountInput('68000')).toBe('68,000')
    expect(formatAmountInput('1234567')).toBe('1,234,567')
    expect(formatAmountInput('999')).toBe('999')
    expect(formatAmountInput('1000')).toBe('1,000')
  })

  it('leaves the fraction ungrouped and keeps a trailing dot', () => {
    expect(formatAmountInput('1234567.5')).toBe('1,234,567.5')
    expect(formatAmountInput('12.')).toBe('12.')
    expect(formatAmountInput('0.05')).toBe('0.05')
  })

  it('formats empty as empty', () => {
    expect(formatAmountInput('')).toBe('')
  })
})

describe('typing into the field', () => {
  it('re-groups progressively as digits are added', () => {
    expect(type('6')).toBe('6')
    expect(type('68')).toBe('68')
    expect(type('680')).toBe('680')
    expect(type('6800')).toBe('6,800')
    expect(type('6,8000')).toBe('68,000')
    expect(type('68,0000')).toBe('680,000')
  })

  it('re-groups when a digit inside a grouped number is deleted', () => {
    expect(type('6,00')).toBe('600')
    expect(type('68000')).toBe('68,000')
    expect(type('1,234,56')).toBe('123,456')
  })

  it('supports decimals in the price field but not the tip field', () => {
    expect(type('12,500.5')).toBe('12,500.5')
    expect(type('12,500.5', { integer: true })).toBe('12,500')
  })
})

describe('amountValue', () => {
  it('parses canonical strings exactly', () => {
    expect(amountValue('68000')).toBe(68000)
    expect(amountValue('12.5')).toBe(12.5)
    expect(amountValue('33333.33')).toBe(33333.33)
    expect(amountValue('12.')).toBe(12)
    expect(amountValue('0.')).toBe(0)
    expect(amountValue('')).toBe(0)
  })
})

describe('amountText', () => {
  it('renders stored numbers as grouped text, 0 as empty', () => {
    expect(amountText(68000)).toBe('68,000')
    expect(amountText(33333.33)).toBe('33,333.33')
    expect(amountText(12.5)).toBe('12.5')
    expect(amountText(0)).toBe('')
    expect(amountText(15000, { integer: true })).toBe('15,000')
  })
})
