import { describe, expect, test } from 'bun:test'
import {
  GEMINI_QUOTA_ZONE,
  dayStartInZone,
  decideScanQuota,
  globalDecision,
  nextDayStartInZone,
  retryAfterSeconds,
  slidingWindowDecision,
} from './scan-quota'

const H = 3_600_000
const WINDOW = 24 * H
const now = new Date('2026-07-15T12:00:00Z')
const ago = (hours: number) => new Date(now.getTime() - hours * H)

describe('slidingWindowDecision', () => {
  test('limit 0 disables the check', () => {
    const events = Array.from({ length: 50 }, (_, i) => ago(i))
    expect(slidingWindowDecision(events, 0, WINDOW, now)).toEqual({ allowed: true, retryAt: null })
  })

  test('under the limit → allowed', () => {
    expect(slidingWindowDecision([ago(1), ago(2)], 6, WINDOW, now)).toEqual({
      allowed: true,
      retryAt: null,
    })
  })

  test('exactly at the limit → denied, retryAt = oldest + window', () => {
    const events = [ago(1), ago(5), ago(10), ago(15), ago(20), ago(23)]
    const d = slidingWindowDecision(events, 6, WINDOW, now)
    expect(d.allowed).toBe(false)
    expect(d.retryAt).toEqual(new Date(ago(23).getTime() + WINDOW))
  })

  test('over the limit after a race → retryAt = the event whose expiry frees a slot', () => {
    const events = [ago(1), ago(2), ago(3), ago(4), ago(5), ago(20), ago(23)]
    const d = slidingWindowDecision(events, 6, WINDOW, now)
    expect(d.allowed).toBe(false)
    // After ago(23) expires there are still 6 in the window; ago(20) must go too.
    expect(d.retryAt).toEqual(new Date(ago(20).getTime() + WINDOW))
  })

  test('events older than the window are ignored', () => {
    const events = [ago(25), ago(30), ago(48), ago(72), ago(100), ago(1)]
    expect(slidingWindowDecision(events, 6, WINDOW, now).allowed).toBe(true)
  })

  test('an event exactly one window old has expired', () => {
    const events = [ago(24), ago(1), ago(2), ago(3), ago(4), ago(5)]
    expect(slidingWindowDecision(events, 6, WINDOW, now).allowed).toBe(true)
  })

  test('unsorted input gives the same answer', () => {
    const sorted = [ago(23), ago(20), ago(15), ago(10), ago(5), ago(1)]
    const shuffled = [ago(5), ago(23), ago(1), ago(15), ago(20), ago(10)]
    expect(slidingWindowDecision(shuffled, 6, WINDOW, now)).toEqual(
      slidingWindowDecision(sorted, 6, WINDOW, now)
    )
  })
})

describe('globalDecision', () => {
  test('limit 0 disables', () => {
    expect(globalDecision(10_000, 0, now).allowed).toBe(true)
  })

  test('under the cap → allowed', () => {
    expect(globalDecision(449, 450, now)).toEqual({ allowed: true, retryAt: null })
  })

  test('at the cap → denied until the next Pacific midnight', () => {
    const d = globalDecision(450, 450, now)
    expect(d.allowed).toBe(false)
    expect(d.retryAt).toEqual(new Date('2026-07-16T07:00:00Z'))
  })
})

describe('decideScanQuota', () => {
  const base = { userLimit: 6, windowMs: WINDOW, globalLimit: 450, now }
  const full = [ago(1), ago(2), ago(3), ago(4), ago(5), ago(6)]

  test('nothing hit → ok', () => {
    expect(decideScanQuota({ ...base, userEvents: [ago(1)], globalCount: 10 })).toEqual({ ok: true })
  })

  test('only the user limit hit → user_limit', () => {
    const d = decideScanQuota({ ...base, userEvents: full, globalCount: 10 })
    expect(d).toEqual({ ok: false, code: 'user_limit', retryAt: new Date(ago(6).getTime() + WINDOW) })
  })

  test('only the global cap hit → global_limit', () => {
    const d = decideScanQuota({ ...base, userEvents: [], globalCount: 450 })
    expect(d).toEqual({ ok: false, code: 'global_limit', retryAt: new Date('2026-07-16T07:00:00Z') })
  })

  test('both hit, user later → user_limit with the later time', () => {
    // Oldest event 4.5 h ago → slot frees at now + 19.5 h = 2026-07-16T07:30Z,
    // after the 07:00Z Pacific reset.
    const events = [ago(1), ago(2), ago(3), ago(4), ago(4.5), ago(0.5)]
    const d = decideScanQuota({ ...base, userEvents: events, globalCount: 450 })
    expect(d).toEqual({ ok: false, code: 'user_limit', retryAt: new Date('2026-07-16T07:30:00Z') })
  })

  test('both hit, global later → global_limit with the later time', () => {
    // User's slot frees at now + 1h = 13:00Z today, before the 07:00Z reset tomorrow.
    const events = [ago(23), ago(22), ago(21), ago(20), ago(19), ago(18)]
    const d = decideScanQuota({ ...base, userEvents: events, globalCount: 450 })
    expect(d).toEqual({ ok: false, code: 'global_limit', retryAt: new Date('2026-07-16T07:00:00Z') })
  })
})

describe('retryAfterSeconds', () => {
  test('rounds up to whole seconds', () => {
    expect(retryAfterSeconds(new Date(now.getTime() + 1500), now)).toBe(2)
  })

  test('never below 1', () => {
    expect(retryAfterSeconds(now, now)).toBe(1)
    expect(retryAfterSeconds(ago(1), now)).toBe(1)
  })
})

describe('dayStartInZone / nextDayStartInZone (America/Los_Angeles)', () => {
  const cases: Array<[label: string, at: string, start: string, next: string]> = [
    ['summer (PDT, UTC-7)', '2026-07-15T12:00:00Z', '2026-07-15T07:00:00Z', '2026-07-16T07:00:00Z'],
    ['winter (PST, UTC-8)', '2026-01-15T12:00:00Z', '2026-01-15T08:00:00Z', '2026-01-16T08:00:00Z'],
    ['one minute before the reset', '2026-07-15T06:59:00Z', '2026-07-14T07:00:00Z', '2026-07-15T07:00:00Z'],
    ['exactly at the reset', '2026-07-15T07:00:00Z', '2026-07-15T07:00:00Z', '2026-07-16T07:00:00Z'],
    ['DST start day (23 h long)', '2026-03-08T17:00:00Z', '2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
    ['DST end day (25 h long)', '2026-11-01T18:00:00Z', '2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
  ]

  for (const [label, at, start, next] of cases) {
    test(label, () => {
      const d = new Date(at)
      expect(dayStartInZone(d, GEMINI_QUOTA_ZONE).toISOString()).toBe(new Date(start).toISOString())
      expect(nextDayStartInZone(d, GEMINI_QUOTA_ZONE).toISOString()).toBe(new Date(next).toISOString())
    })
  }

  test('works for a UTC+5 zone too (Asia/Tashkent, no DST)', () => {
    const d = new Date('2026-07-15T12:00:00Z') // 17:00 Tashkent
    expect(dayStartInZone(d, 'Asia/Tashkent').toISOString()).toBe('2026-07-14T19:00:00.000Z')
    expect(nextDayStartInZone(d, 'Asia/Tashkent').toISOString()).toBe('2026-07-15T19:00:00.000Z')
  })
})
