/**
 * Trailing-edge debounce for board edits.
 *
 * Telegram allows roughly 20 messages a minute to a group and counts edits
 * against it, so ten people tapping Join within a few seconds must not become
 * ten edits. Every render reads fresh state from the database, so collapsing
 * bursts loses nothing — the last edit shows the same thing all ten would have.
 *
 * Pure decision here; the timer and the Map live in group-board.service, the
 * same split as utils/last-seen and its markSeen.
 */

export const BOARD_MIN_INTERVAL_MS = 3_000

export type BoardEditDecision =
  | { action: 'edit' }
  | { action: 'schedule'; inMs: number }
  | { action: 'skip' }

/**
 * @param lastEditAt  epoch ms of the last successful edit, or null if never
 * @param pendingAt   epoch ms an edit is already scheduled for, or null
 */
export function decideBoardEdit(
  lastEditAt: number | null,
  pendingAt: number | null,
  now: number,
  minIntervalMs: number = BOARD_MIN_INTERVAL_MS
): BoardEditDecision {
  // An edit is already queued and will read fresh state when it fires, so this
  // caller has nothing left to do.
  if (pendingAt !== null) return { action: 'skip' }

  if (lastEditAt === null) return { action: 'edit' }

  const elapsed = now - lastEditAt
  if (elapsed >= minIntervalMs) return { action: 'edit' }
  return { action: 'schedule', inMs: minIntervalMs - elapsed }
}
