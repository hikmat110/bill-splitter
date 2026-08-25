// Pure authorization guards for Mini App mutations. Structural param types keep
// these DB-free and unit-testable.

import type { User } from '../db/schema'

/** Only the bill's creator may manage it (remind / confirm / dispute). */
export function canManageBill(user: User, bill: { creator_id: string }): boolean {
  return bill.creator_id === user.id
}

/** Admins are the Telegram ids listed in ADMIN_TELEGRAM_IDS (passed in, not read
 *  from config, to keep this module pure). */
export function isAdmin(
  user: { telegram_id: bigint },
  adminIds: number[]
): boolean {
  return adminIds.includes(Number(user.telegram_id))
}

/** Only the registered user the participant's contact links to may mark it paid. */
export function canMarkPaid(
  user: User,
  participant: { contact: { linked_user_id: string | null } }
): boolean {
  return participant.contact.linked_user_id === user.id
}
