// Decisions behind the support-thread flow, kept pure (no DB, no grammy) so
// they are unit-testable — same reasoning as utils/last-seen and
// utils/telegram-errors.

/** Ack the user at most once per this window, so a burst of typed lines gets
 *  one "we got it" rather than one per line. */
export const SUPPORT_ACK_WINDOW_MS = 30 * 60_000

/** DM the admins at most once per this window, for the same reason. The unread
 *  badge still counts every message. */
export const ADMIN_PING_WINDOW_MS = 5 * 60_000

/**
 * Whether a text message the bot could not route to any wizard should become a
 * support message. Commands are excluded: an unmatched `/foo` still reaches the
 * `message:text` handler and must not be filed as a support ticket.
 */
export function isSupportCandidate(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  return !trimmed.startsWith('/')
}

/**
 * True when `now` starts a fresh burst — i.e. nothing was received before, or
 * the previous message is at least `windowMs` old. Mirrors the shape of
 * shouldTouchLastSeen.
 */
export function isNewBurst(lastAt: Date | null, now: Date, windowMs: number): boolean {
  if (!lastAt) return true
  return now.getTime() - lastAt.getTime() >= windowMs
}
