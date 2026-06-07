import { describe, it, expect } from 'bun:test'
import { canManageBill, canMarkPaid } from './authz'
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
