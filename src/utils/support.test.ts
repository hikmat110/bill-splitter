import { describe, expect, test } from 'bun:test'
import { ADMIN_PING_WINDOW_MS, isNewBurst, isSupportCandidate } from './support'

const now = new Date('2026-07-15T12:00:00Z')

describe('isSupportCandidate', () => {
  test('plain text → yes', () => {
    expect(isSupportCandidate('the split is wrong')).toBe(true)
  })

  test('empty / whitespace-only → no', () => {
    expect(isSupportCandidate('')).toBe(false)
    expect(isSupportCandidate('   \n ')).toBe(false)
  })

  test('an unmatched command → no', () => {
    expect(isSupportCandidate('/foo')).toBe(false)
    expect(isSupportCandidate('  /start')).toBe(false)
  })

  test('a slash inside the text is fine', () => {
    expect(isSupportCandidate('split 50/50 please')).toBe(true)
  })
})

describe('isNewBurst', () => {
  test('nothing before → new burst', () => {
    expect(isNewBurst(null, now, ADMIN_PING_WINDOW_MS)).toBe(true)
  })

  test('a message a second ago → same burst', () => {
    expect(isNewBurst(new Date(now.getTime() - 1000), now, ADMIN_PING_WINDOW_MS)).toBe(false)
  })

  test('exactly one window ago → new burst', () => {
    expect(
      isNewBurst(new Date(now.getTime() - ADMIN_PING_WINDOW_MS), now, ADMIN_PING_WINDOW_MS)
    ).toBe(true)
  })

  test('just inside the window → same burst', () => {
    expect(
      isNewBurst(new Date(now.getTime() - ADMIN_PING_WINDOW_MS + 1), now, ADMIN_PING_WINDOW_MS)
    ).toBe(false)
  })

  test('long ago → new burst', () => {
    expect(isNewBurst(new Date('2026-01-01T00:00:00Z'), now, ADMIN_PING_WINDOW_MS)).toBe(true)
  })
})
