import { describe, expect, test } from 'bun:test'
import {
  ADMIN_ZONE,
  escapeLike,
  fillWeeks,
  mergeActivity,
  parseUserQuery,
  weekKeys,
} from './admin-stats'

describe('weekKeys', () => {
  test('ends with the Monday of the current week, oldest first', () => {
    // Wed 15 Jul 2026, 17:00 Tashkent
    expect(weekKeys(new Date('2026-07-15T12:00:00Z'), ADMIN_ZONE, 3)).toEqual([
      '2026-06-29',
      '2026-07-06',
      '2026-07-13',
    ])
  })

  test('Sunday night UTC is already Monday in Tashkent', () => {
    // 2026-07-19T20:00Z = Mon 20 Jul 01:00 in Tashkent (UTC+5)
    const now = new Date('2026-07-19T20:00:00Z')
    expect(weekKeys(now, ADMIN_ZONE, 1)).toEqual(['2026-07-20'])
    expect(weekKeys(now, 'UTC', 1)).toEqual(['2026-07-13'])
  })

  test('Monday just after midnight stays in the new week', () => {
    // 2026-07-12T19:30Z = Mon 13 Jul 00:30 in Tashkent
    expect(weekKeys(new Date('2026-07-12T19:30:00Z'), ADMIN_ZONE, 1)).toEqual(['2026-07-13'])
  })

  test('a Monday maps to itself', () => {
    expect(weekKeys(new Date('2026-07-13T09:00:00Z'), ADMIN_ZONE, 1)).toEqual(['2026-07-13'])
  })

  test('crosses month and year boundaries', () => {
    expect(weekKeys(new Date('2026-01-02T12:00:00Z'), ADMIN_ZONE, 2)).toEqual([
      '2025-12-22',
      '2025-12-29',
    ])
  })
})

describe('fillWeeks', () => {
  const keys = ['2026-06-29', '2026-07-06', '2026-07-13']

  test('zero-fills missing weeks and keeps key order', () => {
    expect(fillWeeks([{ week: '2026-07-06', count: 4 }], keys)).toEqual([
      { week: '2026-06-29', count: 0 },
      { week: '2026-07-06', count: 4 },
      { week: '2026-07-13', count: 0 },
    ])
  })

  test('drops rows outside the key range', () => {
    expect(fillWeeks([{ week: '2026-06-22', count: 9 }], keys).every((b) => b.count === 0)).toBe(
      true
    )
  })
})

describe('mergeActivity', () => {
  const at = (iso: string) => ({ at: new Date(iso) })

  test('interleaves sources newest first and applies the limit', () => {
    const a = [at('2026-07-15T10:00:00Z'), at('2026-07-15T08:00:00Z')]
    const b = [at('2026-07-15T09:00:00Z'), at('2026-07-15T07:00:00Z')]
    expect(mergeActivity([a, b], 3).map((x) => x.at.toISOString())).toEqual([
      '2026-07-15T10:00:00.000Z',
      '2026-07-15T09:00:00.000Z',
      '2026-07-15T08:00:00.000Z',
    ])
  })

  test('empty sources → empty feed', () => {
    expect(mergeActivity([[], []], 20)).toEqual([])
  })
})

describe('escapeLike', () => {
  test('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d')
  })
})

describe('parseUserQuery', () => {
  test('empty → nothing to match', () => {
    expect(parseUserQuery('   ')).toEqual({ like: null, phoneLike: null, telegramId: null })
  })

  test('name text → escaped ILIKE pattern, no phone or id', () => {
    expect(parseUserQuery('Ali')).toEqual({ like: '%Ali%', phoneLike: null, telegramId: null })
  })

  test('strips a leading @ and escapes underscores in usernames', () => {
    expect(parseUserQuery('@ali_dev').like).toBe('%ali\\_dev%')
  })

  test('phone fragment matches on digits only', () => {
    expect(parseUserQuery('+998 90 123')).toEqual({
      like: '%+998 90 123%',
      phoneLike: '%99890123%',
      telegramId: null,
    })
  })

  test('pure number of 5+ digits is also an exact telegram id', () => {
    expect(parseUserQuery('123456789').telegramId).toBe(123456789n)
    expect(parseUserQuery('1234').telegramId).toBeNull()
  })
})
