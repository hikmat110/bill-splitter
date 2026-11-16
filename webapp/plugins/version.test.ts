import { describe, expect, test } from 'bun:test'
import { makeBuild, resolveStamp } from './version'

const noGit = () => null

describe('resolveStamp', () => {
  test('APP_COMMIT wins and is truncated to 7 chars', () => {
    expect(resolveStamp({ APP_COMMIT: '5e113c9abcdef' }, () => 'gitgit1')).toBe('5e113c9')
  })

  test('APP_COMMIT is trimmed, and blank falls through to git', () => {
    expect(resolveStamp({ APP_COMMIT: '  abc1234  ' }, noGit)).toBe('abc1234')
    expect(resolveStamp({ APP_COMMIT: '   ' }, () => 'gitgit1')).toBe('gitgit1')
  })

  test('git is used when APP_COMMIT is unset', () => {
    expect(resolveStamp({}, () => 'abc1234-dirty')).toBe('abc1234-dirty')
  })

  test('falls back to a timestamp when git is unavailable (the server case)', () => {
    // Must never be a constant: two builds compared as equal would silently
    // disable the stale check.
    expect(resolveStamp({}, noGit)).toMatch(/^b[0-9a-z]+$/)
  })
})

describe('makeBuild', () => {
  test('buildId joins version and stamp', () => {
    const b = makeBuild('0.1.0', '5e113c9', '2026-08-06T00:00:00.000Z')
    expect(b.buildId).toBe('0.1.0+5e113c9')
    expect(b.version).toBe('0.1.0')
    expect(b.stamp).toBe('5e113c9')
  })

  test('builtAt is not part of buildId — a rebuild of the same source matches', () => {
    const a = makeBuild('0.1.0', '5e113c9', '2026-08-06T00:00:00.000Z')
    const b = makeBuild('0.1.0', '5e113c9', '2026-08-07T12:00:00.000Z')
    expect(a.buildId).toBe(b.buildId)
    expect(a.builtAt).not.toBe(b.builtAt)
  })
})
