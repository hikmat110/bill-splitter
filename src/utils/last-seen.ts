/**
 * Throttle for the users.last_seen_at bump. Pure so it is unit-testable; the
 * DB write lives in user.service (markSeen), which repeats the same guard in
 * SQL so concurrent requests stay idempotent.
 */

export const LAST_SEEN_THROTTLE_MS = 5 * 60_000

/** True when the stored value is missing or older than the throttle window. */
export function shouldTouchLastSeen(lastSeenAt: Date | null, now: Date): boolean {
  if (!lastSeenAt) return true
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS
}
