import type { BillDetail, BillParticipant, Me } from './types'

/** True when this participant is the current user (their own share). */
export function isSelf(p: BillParticipant, me: Me): boolean {
  return p.contactId === me.selfContactId || p.linkedUserId === me.id
}

/** Sum still owed to the creator on one of their bills (others, not yet confirmed). */
export function createdOutstanding(bill: BillDetail, me: Me): number {
  return bill.participants
    .filter((p) => !isSelf(p, me) && p.status !== 'confirmed')
    .reduce((s, p) => s + p.amount, 0)
}

/** Confirmed / total count among the other participants on a created bill. */
export function paidCount(bill: BillDetail, me: Me): { paid: number; total: number } {
  const others = bill.participants.filter((p) => !isSelf(p, me))
  return { paid: others.filter((p) => p.status === 'confirmed').length, total: others.length }
}
