import { describe, it, expect } from 'bun:test'
import { canManageBill, canMarkPaid, isAdmin } from './authz'
import type { User } from '../db/schema'

const user = (id: string) => ({ id }) as User

describe('canManageBill', () => {
  it('is true only for the creator', () => {
    expect(canManageBill(user('u1'), { creator_id: 'u1' })).toBe(true)
    expect(canManageBill(user('u2'), { creator_id: 'u1' })).toBe(false)
  })
})

describe('canMarkPaid', () => {
  it('is true only for the linked participant', () => {
    expect(canMarkPaid(user('u1'), { contact: { linked_user_id: 'u1' } })).toBe(true)
    expect(canMarkPaid(user('u2'), { contact: { linked_user_id: 'u1' } })).toBe(false)
  })

  it('is false for an unlinked contact', () => {
    expect(canMarkPaid(user('u1'), { contact: { linked_user_id: null } })).toBe(false)
  })
})

describe('isAdmin', () => {
  it('is true when the telegram id is in the admin list', () => {
    expect(isAdmin({ telegram_id: 123n }, [123, 456])).toBe(true)
  })

  it('is false when the telegram id is not in the list', () => {
    expect(isAdmin({ telegram_id: 789n }, [123, 456])).toBe(false)
  })

  it('is false for an empty admin list', () => {
    expect(isAdmin({ telegram_id: 123n }, [])).toBe(false)
  })
})
