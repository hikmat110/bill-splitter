import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { verifyInitData } from './init-data'

const TOKEN = '123456:TEST_TOKEN'

/** Produce a correctly-signed initData query string for the given fields. */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secret).update(dcs).digest('hex')
  const usp = new URLSearchParams(fields)
  usp.set('hash', hash)
  return usp.toString()
}

const nowSec = Math.floor(Date.now() / 1000)
const validFields = {
  auth_date: String(nowSec),
  query_id: 'AAES',
  user: JSON.stringify({ id: 42, first_name: 'Alice', username: 'alice' }),
}

describe('verifyInitData', () => {
  it('accepts a correctly-signed payload and parses the user', () => {
    const result = verifyInitData(sign(validFields), TOKEN)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.id).toBe(42)
      expect(result.user.username).toBe('alice')
    }
  })

  it('ignores a `signature` field when checking the HMAC', () => {
    // signature is excluded from the data-check-string, so adding one must not break it.
    const initData = sign(validFields) + '&signature=ed25519stub'
    expect(verifyInitData(initData, TOKEN).ok).toBe(true)
  })

  it('rejects a tampered hash', () => {
    const initData = sign(validFields).replace(/hash=([0-9a-f])/, (_m, c) =>
      `hash=${c === 'a' ? 'b' : 'a'}`
    )
    const result = verifyInitData(initData, TOKEN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad hash')
  })

  it('rejects a tampered field (hash no longer matches)', () => {
    const usp = new URLSearchParams(sign(validFields))
    usp.set('user', JSON.stringify({ id: 999, first_name: 'Mallory' }))
    const result = verifyInitData(usp.toString(), TOKEN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad hash')
  })

  it('rejects when signed with a different token', () => {
    const result = verifyInitData(sign(validFields, 'other:TOKEN'), TOKEN)
    expect(result.ok).toBe(false)
  })

  it('rejects a missing hash', () => {
    const usp = new URLSearchParams(validFields)
    const result = verifyInitData(usp.toString(), TOKEN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('missing hash')
  })

  it('rejects empty initData', () => {
    const result = verifyInitData('', TOKEN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty initData')
  })

  it('rejects a stale auth_date', () => {
    const stale = { ...validFields, auth_date: String(nowSec - 100_000) }
    const result = verifyInitData(sign(stale), TOKEN) // default maxAge 24h
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('stale auth_date')
  })

  it('allows an old auth_date when the age check is disabled', () => {
    const stale = { ...validFields, auth_date: String(nowSec - 100_000) }
    const result = verifyInitData(sign(stale), TOKEN, { maxAgeSeconds: 0 })
    expect(result.ok).toBe(true)
  })

  it('rejects a missing user', () => {
    const { user, ...noUser } = validFields
    void user
    const result = verifyInitData(sign(noUser), TOKEN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('missing user')
  })
})
