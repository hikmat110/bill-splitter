import { describe, expect, test } from 'bun:test'
import { normalizeUsername, parseUsernameList } from './username'

describe('normalizeUsername', () => {
  test('strips a single leading @', () => {
    expect(normalizeUsername('@john')).toBe('john')
  })

  test('strips multiple leading @', () => {
    expect(normalizeUsername('@@john')).toBe('john')
  })

  test('lowercases for case-insensitive matching', () => {
    expect(normalizeUsername('@JohnDoe')).toBe('johndoe')
  })

  test('accepts input without @', () => {
    expect(normalizeUsername('john')).toBe('john')
  })

  test('trims surrounding whitespace', () => {
    expect(normalizeUsername('  @john  ')).toBe('john')
  })

  test('trims whitespace between @ and name', () => {
    expect(normalizeUsername('@ john ')).toBe('john')
  })

  // Critical: underscores must be preserved verbatim, NOT treated as wildcards.
  // This is the whole reason we moved off ILIKE — `john_doe` must not match `johnXdoe`.
  test('preserves underscores', () => {
    expect(normalizeUsername('@john_doe')).toBe('john_doe')
  })

  test('preserves digits', () => {
    expect(normalizeUsername('@user123')).toBe('user123')
  })

  test('does not interpret % as a wildcard (kept literal)', () => {
    expect(normalizeUsername('@a%b')).toBe('a%b')
  })

  test('returns empty string for only @', () => {
    expect(normalizeUsername('@')).toBe('')
  })

  test('returns empty string for whitespace only', () => {
    expect(normalizeUsername('   ')).toBe('')
  })

  test('returns empty string for empty input', () => {
    expect(normalizeUsername('')).toBe('')
  })

  test('is idempotent', () => {
    const once = normalizeUsername('@John_Doe')
    expect(normalizeUsername(once)).toBe(once)
  })
})

describe('parseUsernameList', () => {
  test('parses a single handle', () => {
    expect(parseUsernameList('@john')).toEqual(['john'])
  })

  test('splits on commas', () => {
    expect(parseUsernameList('@a,@b,@c')).toEqual(['a', 'b', 'c'])
  })

  test('splits on spaces', () => {
    expect(parseUsernameList('@a @b @c')).toEqual(['a', 'b', 'c'])
  })

  test('splits on newlines', () => {
    expect(parseUsernameList('@a\n@b\n@c')).toEqual(['a', 'b', 'c'])
  })

  test('handles a mix of separators and extra whitespace', () => {
    expect(parseUsernameList('  @Alex ,  kavin\n@DILNOZA ')).toEqual(['alex', 'kavin', 'dilnoza'])
  })

  test('de-duplicates case-insensitively, preserving first-seen order', () => {
    expect(parseUsernameList('@Alex, alex, @ALEX, bob')).toEqual(['alex', 'bob'])
  })

  test('drops empty tokens (stray separators)', () => {
    expect(parseUsernameList('@a,,  ,@b')).toEqual(['a', 'b'])
  })

  test('preserves underscores and digits', () => {
    expect(parseUsernameList('@john_doe @user123')).toEqual(['john_doe', 'user123'])
  })

  test('returns empty array for blank input', () => {
    expect(parseUsernameList('   ,  \n ')).toEqual([])
  })
})
