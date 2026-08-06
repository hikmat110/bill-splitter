// Encryption-at-rest for card numbers (AES-256-GCM).
//
// Wire format: `v1.<iv b64>.<tag b64>.<ct b64>`. Base64 never contains '.', so
// dot-splitting is unambiguous; the `v1.` prefix lets the backfill script tell
// encrypted rows from legacy plaintext and leaves room for a future format
// (e.g. a v2 binding user_id as AAD if in-DB tamper resistance ever matters).
//
// The pure functions take keys explicitly so tests need no env; services import
// the config-bound wrappers at the bottom. card.service is the sole caller —
// plaintext never leaves that boundary except through its return values.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config'

const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_HEX_RE = /^[0-9a-f]{64}$/i
const PLAINTEXT_PAN_RE = /^\d{16}$/

/** Never carries card data — safe to log. Callers may attach the card row id. */
export class CardDecryptionError extends Error {
  cardId?: string
  constructor(cardId?: string) {
    super('Card decryption failed')
    this.name = 'CardDecryptionError'
    this.cardId = cardId
  }
}

/** Parse a 64-hex-char key (openssl rand -hex 32) into 32 bytes. */
export function parseKeyHex(hex: string): Buffer {
  if (!KEY_HEX_RE.test(hex)) {
    throw new Error('Card encryption key must be exactly 64 hex characters')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptWithKey(key: Buffer, plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`
}

/**
 * Decrypt a stored card number. A bare 16-digit value is returned as-is —
 * legacy plaintext rows must keep working until `db:encrypt-cards` has run.
 * Keys are tried in order (current first, then previous during rotation).
 * Anything malformed or tampered throws CardDecryptionError, never garbage.
 */
export function decryptWithKeys(keys: Buffer[], stored: string): string {
  if (PLAINTEXT_PAN_RE.test(stored)) return stored
  const parts = stored.split('.')
  if (parts[0] !== 'v1' || parts.length !== 4) throw new CardDecryptionError()
  const iv = Buffer.from(parts[1]!, 'base64')
  const tag = Buffer.from(parts[2]!, 'base64')
  const ct = Buffer.from(parts[3]!, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CardDecryptionError()
  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
    } catch {
      // GCM auth failure: wrong key or tampered ciphertext — try the next key.
    }
  }
  throw new CardDecryptionError()
}

/** Whether a stored value is already in the encrypted wire format. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith('v1.')
}

// ─── config-bound wrappers ────────────────────────────────────────────────────

const keys: Buffer[] = [
  parseKeyHex(config.CARD_ENCRYPTION_KEY),
  ...(config.CARD_ENCRYPTION_KEY_PREVIOUS
    ? [parseKeyHex(config.CARD_ENCRYPTION_KEY_PREVIOUS)]
    : []),
]

export function encryptCardNumber(plain: string): string {
  return encryptWithKey(keys[0]!, plain)
}

export function decryptCardNumber(stored: string): string {
  return decryptWithKeys(keys, stored)
}
