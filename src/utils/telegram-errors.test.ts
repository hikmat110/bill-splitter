import { describe, expect, test } from 'bun:test'
import { classifySendError } from './telegram-errors'

describe('classifySendError', () => {
  test('403 → blocked', () => {
    expect(
      classifySendError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' })
    ).toBe('blocked')
    expect(classifySendError({ error_code: 403, description: 'Forbidden: user is deactivated' })).toBe(
      'blocked'
    )
  })

  test('400 chat not found → chat_not_found', () => {
    expect(
      classifySendError({ error_code: 400, description: 'Bad Request: chat not found' })
    ).toBe('chat_not_found')
  })

  test('other 400s → send_failed', () => {
    expect(
      classifySendError({ error_code: 400, description: 'Bad Request: message is too long' })
    ).toBe('send_failed')
  })

  test('429 → rate_limited', () => {
    expect(classifySendError({ error_code: 429, description: 'Too Many Requests' })).toBe(
      'rate_limited'
    )
  })

  test('non-API errors → send_failed', () => {
    expect(classifySendError(new Error('socket hang up'))).toBe('send_failed')
    expect(classifySendError(null)).toBe('send_failed')
    expect(classifySendError('nope')).toBe('send_failed')
  })
})
