import { describe, expect, test } from 'bun:test'
import { LAST_SEEN_THROTTLE_MS, shouldTouchLastSeen } from './last-seen'

const now = new Date('2026-07-15T12:00:00Z')

describe('shouldTouchLastSeen', () => {
  test('never seen → touch', () => {
    expect(shouldTouchLastSeen(null, now)).toBe(true)
  })

  test('seen just now → skip', () => {
    expect(shouldTouchLastSeen(new Date(now.getTime() - 1000), now)).toBe(false)
  })

  test('seen exactly one throttle window ago → touch', () => {
    expect(shouldTouchLastSeen(new Date(now.getTime() - LAST_SEEN_THROTTLE_MS), now)).toBe(true)
  })

  test('seen just inside the window → skip', () => {
    expect(shouldTouchLastSeen(new Date(now.getTime() - LAST_SEEN_THROTTLE_MS + 1), now)).toBe(
      false
    )
  })

  test('seen long ago → touch', () => {
    expect(shouldTouchLastSeen(new Date('2026-01-01T00:00:00Z'), now)).toBe(true)
  })
})
