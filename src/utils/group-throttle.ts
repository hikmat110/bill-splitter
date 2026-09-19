/**
 * Per-chat / per-member reply throttles for group commands.
 *
 * The bot answers a group only when spoken to, but "spoken to" still has to be
 * rate-limited: a stranger repeatedly typing /split must not produce a wall of
 * "start the bot first". Over the limit the correct answer in a group is
 * silence, not another message.
 *
 * Pure decision here; the Map lives in the handler, same split as
 * utils/last-seen and markSeen.
 */

/** A stranger is told how to register at most this often, per chat. */
export const NEED_ACCOUNT_WINDOW_MS = 10 * 60_000

/** /board re-posts a card at most this often, per chat. */
export const BOARD_COMMAND_WINDOW_MS = 60_000

/** How long a group reminder blocks the next one, per split. */
export const REMIND_WINDOW_MS = 60 * 60_000

export function shouldReplyAgain(
  lastAt: number | null | undefined,
  now: number,
  windowMs: number
): boolean {
  if (lastAt === null || lastAt === undefined) return true
  return now - lastAt >= windowMs
}

/**
 * Minimal TTL map. Entries older than `windowMs` are dropped on write, so an
 * unbounded number of chats cannot grow it without bound.
 */
export class ReplyThrottle {
  private readonly seen = new Map<string, number>()

  constructor(private readonly windowMs: number) {}

  /** True if the caller may reply now; records the reply when it returns true. */
  take(key: string, now: number = Date.now()): boolean {
    if (!shouldReplyAgain(this.seen.get(key), now, this.windowMs)) return false
    this.prune(now)
    this.seen.set(key, now)
    return true
  }

  private prune(now: number): void {
    for (const [k, at] of this.seen) {
      if (now - at >= this.windowMs) this.seen.delete(k)
    }
  }
}
