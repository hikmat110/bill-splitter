import { describe, it, expect } from 'bun:test'
import { isUniqueViolation } from './pg-errors'

describe('isUniqueViolation', () => {
  it('recognises the SQLSTATE code', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('recognises a driver message when no code is present', () => {
    expect(isUniqueViolation(new Error('duplicate key value violates ...'))).toBe(true)
    expect(isUniqueViolation(new Error('unique constraint failed'))).toBe(true)
  })

  it('rejects unrelated failures', () => {
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
