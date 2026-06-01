import { describe, expect, test } from 'bun:test'
import { encode, decode, CallbackParseError } from './callback'

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

describe('encode/decode', () => {
  test('roundtrip preserves entity, action, id', () => {
    const data = encode('bill', 'mark_paid', UUID)
    const result = decode(data)
    expect(result.entity).toBe('bill')
    expect(result.action).toBe('mark_paid')
    expect(result.id).toBe(UUID)
  })

  test('encode produces colon-separated string', () => {
    expect(encode('contact', 'view', UUID)).toBe(`contact:view:${UUID}`)
  })

  test('encode throws when data exceeds 64 bytes', () => {
    const longId = 'a'.repeat(64)
    expect(() => encode('bill', 'mark_paid', longId)).toThrow('64 bytes')
  })

  test('decode throws CallbackParseError on missing parts', () => {
    expect(() => decode('bill:mark_paid')).toThrow(CallbackParseError)
  })

  test('decode throws CallbackParseError on empty string', () => {
    expect(() => decode('')).toThrow(CallbackParseError)
  })

  test('decode throws CallbackParseError on single segment', () => {
    expect(() => decode('bill')).toThrow(CallbackParseError)
  })
})
