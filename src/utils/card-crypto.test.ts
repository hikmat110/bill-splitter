import { describe, expect, test } from 'bun:test'
import {
  CardDecryptionError,
  decryptWithKeys,
  encryptWithKey,
  isEncrypted,
  parseKeyHex,
} from './card-crypto'

const keyA = parseKeyHex('aa'.repeat(32))
const keyB = parseKeyHex('bb'.repeat(32))
const PAN = '8600123412341234'

/** Flip one character inside dot-segment `index` of a v1 ciphertext. */
function tamperSegment(stored: string, index: number): string {
  const parts = stored.split('.')
  const seg = parts[index]!
  const flipped = (seg[0] === 'A' ? 'B' : 'A') + seg.slice(1)
  parts[index] = flipped
  return parts.join('.')
}

describe('parseKeyHex', () => {
  test('accepts 64 hex chars, either case', () => {
    expect(parseKeyHex('ab'.repeat(32)).length).toBe(32)
    expect(parseKeyHex('AB'.repeat(32)).length).toBe(32)
  })

  test('rejects wrong length and non-hex', () => {
    expect(() => parseKeyHex('ab'.repeat(31))).toThrow()
    expect(() => parseKeyHex('ab'.repeat(32) + 'ab')).toThrow()
    expect(() => parseKeyHex('zz'.repeat(32))).toThrow()
    expect(() => parseKeyHex('')).toThrow()
  })
})

describe('encryptWithKey / decryptWithKeys', () => {
  test('roundtrip returns the input', () => {
    expect(decryptWithKeys([keyA], encryptWithKey(keyA, PAN))).toBe(PAN)
  })

  test('same plaintext encrypts differently each time (random IV), both decrypt', () => {
    const a = encryptWithKey(keyA, PAN)
    const b = encryptWithKey(keyA, PAN)
    expect(a).not.toBe(b)
    expect(decryptWithKeys([keyA], a)).toBe(PAN)
    expect(decryptWithKeys([keyA], b)).toBe(PAN)
  })

  test('wire format: v1 prefix, 4 dot-parts, 12-byte IV, 16-byte tag', () => {
    const parts = encryptWithKey(keyA, PAN).split('.')
    expect(parts.length).toBe(4)
    expect(parts[0]).toBe('v1')
    expect(Buffer.from(parts[1]!, 'base64').length).toBe(12)
    expect(Buffer.from(parts[2]!, 'base64').length).toBe(16)
    expect(Buffer.from(parts[3]!, 'base64').length).toBeGreaterThan(0)
  })

  test('legacy 16-digit plaintext passes through untouched', () => {
    expect(decryptWithKeys([keyA], PAN)).toBe(PAN)
  })

  test('tampering any segment throws, never returns garbage', () => {
    const stored = encryptWithKey(keyA, PAN)
    for (const seg of [1, 2, 3]) {
      expect(() => decryptWithKeys([keyA], tamperSegment(stored, seg))).toThrow(
        CardDecryptionError
      )
    }
  })

  test('wrong key throws', () => {
    expect(() => decryptWithKeys([keyB], encryptWithKey(keyA, PAN))).toThrow(
      CardDecryptionError
    )
  })

  test('previous-key fallback: old ciphertext decrypts with [new, old]', () => {
    const stored = encryptWithKey(keyA, PAN)
    expect(decryptWithKeys([keyB, keyA], stored)).toBe(PAN)
  })

  test('malformed inputs throw', () => {
    for (const bad of ['', 'v2.x.y.z', 'v1.only.two', 'v1.a.b.c.d', '860012341234123']) {
      expect(() => decryptWithKeys([keyA], bad)).toThrow(CardDecryptionError)
    }
  })
})

describe('isEncrypted', () => {
  test('true for ciphertext, false for plaintext digits', () => {
    expect(isEncrypted(encryptWithKey(keyA, PAN))).toBe(true)
    expect(isEncrypted(PAN)).toBe(false)
  })
})
