import type { BillDetail, BillParticipant, BillsResponse, Me } from './types'

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

/** Items needing the user's attention, derived from the standard bills fetch:
 *  payments awaiting their confirmation (creator side) plus bills they still
 *  owe or had disputed (payer side). Drives the Inbox tab and its badge. */
export function inboxCount(bills: BillsResponse, me: Me): number {
  const toConfirm = bills.created
    .filter((b) => !b.archivedAt)
    .flatMap((b) => b.participants)
    .filter((p) => !isSelf(p, me) && p.status === 'marked_paid').length
  const toPay = bills.incoming.filter(
    (x) => x.participant.status === 'pending' || x.participant.status === 'disputed'
  ).length
  return toConfirm + toPay
}
