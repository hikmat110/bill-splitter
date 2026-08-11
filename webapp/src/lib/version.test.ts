import { describe, expect, test } from 'bun:test'
import { BUILD, VERSION_LABEL, isStale } from './version'

describe('isStale', () => {
  test('a different server build is stale', () => {
    expect(isStale('0.1.0+aaaaaaa', '0.1.0+bbbbbbb')).toBe(true)
  })

  test('the same build is not', () => {
    expect(isStale('0.1.0+aaaaaaa', '0.1.0+aaaaaaa')).toBe(false)
  })

  test('an unknown server build fails open — never nag on a failed check', () => {
    expect(isStale('0.1.0+aaaaaaa', null)).toBe(false)
  })

  test('an older server build counts too, so a rollback pulls clients down', () => {
    expect(isStale('0.2.0+bbbbbbb', '0.1.0+aaaaaaa')).toBe(true)
  })
})

describe('BUILD', () => {
  test('falls back to a placeholder when the define is absent (no bundler)', () => {
    // Guards against a ReferenceError taking down every importer under bun test.
    expect(BUILD.buildId).toBe('0.0.0+dev')
    expect(VERSION_LABEL).toBe('v0.0.0 · dev')
  })
})
