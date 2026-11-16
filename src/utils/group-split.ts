/**
 * Decision logic for a group split, kept pure so the interesting cases (a stale
 * card blocking a new one, a non-creator pressing Cancel) are unit-testable
 * without a database or a Telegram context.
 */

export type SplitStatus = 'collecting' | 'building' | 'sent' | 'cancelled' | 'expired'

/** Statuses the "one open split per chat" partial unique index covers. */
export const OPEN_STATUSES: readonly SplitStatus[] = ['collecting', 'building']

/** How long an untouched card keeps holding the chat's only open-split slot. */
export const SPLIT_TTL_MS = 6 * 60 * 60_000

export interface OpenSplitLike {
  id: string
  creator_id: string
  status: string
  updated_at: Date
}

export type SplitStartDecision =
  | { action: 'create' }
  | { action: 'reuse'; splitId: string }
  | { action: 'expire_and_create'; splitId: string }

/**
 * What `/split` should do given whatever split is already open in this chat.
 *
 * There is no cron expiring abandoned cards: the unique index means a stale one
 * would block the chat forever, so expiry happens lazily right here. `expired`
 * falls outside the index, so the replacement insert succeeds.
 */
export function decideSplitStart(
  existing: OpenSplitLike | null,
  requesterId: string,
  now: Date,
  ttlMs: number = SPLIT_TTL_MS
): SplitStartDecision {
  if (!existing) return { action: 'create' }
  if (!OPEN_STATUSES.includes(existing.status as SplitStatus)) return { action: 'create' }

  // The person who started it asked again — they want a fresh card, not a
  // lecture about the one they already abandoned.
  if (existing.creator_id === requesterId) {
    return { action: 'expire_and_create', splitId: existing.id }
  }

  if (now.getTime() - existing.updated_at.getTime() > ttlMs) {
    return { action: 'expire_and_create', splitId: existing.id }
  }

  return { action: 'reuse', splitId: existing.id }
}

export type SplitAction = 'join' | 'leave' | 'cancel'

export type PressVerdict =
  | { ok: true }
  | { ok: false; reason: 'closed' | 'not_creator' }

/**
 * Whether a button press is allowed. Authorization is decided from stored split
 * state and the presser's identity — never from which keyboard the press came
 * from, since callback data is attacker-controlled.
 */
export function canPressSplitAction(
  action: SplitAction,
  split: { status: string },
  isCreator: boolean
): PressVerdict {
  const status = split.status as SplitStatus

  if (action === 'cancel') {
    if (!isCreator) return { ok: false, reason: 'not_creator' }
    return OPEN_STATUSES.includes(status) ? { ok: true } : { ok: false, reason: 'closed' }
  }

  // Joining or leaving is only meaningful while the roster is still open; once
  // the creator starts building the bill it is frozen.
  return status === 'collecting' ? { ok: true } : { ok: false, reason: 'closed' }
}
