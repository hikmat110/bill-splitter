/**
 * Pure receipt-scan quota math — no DB, no config — so it is unit-testable.
 * The DB-backed orchestration lives in services/scan-quota.service.ts.
 */

export type ScanLimitCode = 'user_limit' | 'global_limit'

/** IANA zone in which Google's free-tier daily quota (RPD) resets at midnight. */
export const GEMINI_QUOTA_ZONE = 'America/Los_Angeles'

export interface LimitDecision {
  allowed: boolean
  /** When the limit next admits a scan; null when allowed. */
  retryAt: Date | null
}

/**
 * Sliding-window log: at most `limit` events in any `windowMs`-long window.
 * `eventTimes` are the user's counted events (any order; the cutoff is re-applied
 * defensively). `limit <= 0` disables the check.
 */
export function slidingWindowDecision(
  eventTimes: readonly Date[],
  limit: number,
  windowMs: number,
  now: Date
): LimitDecision {
  if (limit <= 0) return { allowed: true, retryAt: null }
  const cutoff = now.getTime() - windowMs
  const inWindow = eventTimes
    .map((d) => d.getTime())
    .filter((t) => t > cutoff)
    .sort((a, b) => a - b)
  if (inWindow.length < limit) return { allowed: true, retryAt: null }
  // The window admits a scan once enough of the oldest events have expired to
  // bring the count under the limit. With exactly `limit` events that is the
  // oldest one; after a concurrent over-admission (n > limit) it is a later one.
  const gate = inWindow[inWindow.length - limit]!
  return { allowed: false, retryAt: new Date(gate + windowMs) }
}

/** Global daily cap on all users combined; resets at midnight in GEMINI_QUOTA_ZONE. */
export function globalDecision(countSinceReset: number, limit: number, now: Date): LimitDecision {
  if (limit <= 0 || countSinceReset < limit) return { allowed: true, retryAt: null }
  return { allowed: false, retryAt: nextDayStartInZone(now, GEMINI_QUOTA_ZONE) }
}

export type QuotaDecision = { ok: true } | { ok: false; code: ScanLimitCode; retryAt: Date }

export interface QuotaInput {
  userEvents: readonly Date[]
  userLimit: number
  windowMs: number
  globalCount: number
  globalLimit: number
  now: Date
}

/** Combines both limits. When both deny, reports the LATER retryAt so the user
 *  is not sent back at a time when the other limit would still block them. */
export function decideScanQuota(input: QuotaInput): QuotaDecision {
  const user = slidingWindowDecision(input.userEvents, input.userLimit, input.windowMs, input.now)
  const global = globalDecision(input.globalCount, input.globalLimit, input.now)
  if (user.allowed && global.allowed) return { ok: true }
  if (!user.allowed && !global.allowed) {
    return user.retryAt!.getTime() >= global.retryAt!.getTime()
      ? { ok: false, code: 'user_limit', retryAt: user.retryAt! }
      : { ok: false, code: 'global_limit', retryAt: global.retryAt! }
  }
  return user.allowed
    ? { ok: false, code: 'global_limit', retryAt: global.retryAt! }
    : { ok: false, code: 'user_limit', retryAt: user.retryAt! }
}

/** Value for a Retry-After header: whole seconds, never below 1. */
export function retryAfterSeconds(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))
}

// ─── Zoned day boundaries (no deps) ──────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(date: Date, timeZone: string): WallClock {
  const w: Partial<Record<keyof WallClock, number>> = {}
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') w[part.type as keyof WallClock] = Number(part.value)
  }
  return w as WallClock
}

/** The zone's UTC offset in force at `date`, in ms (negative west of UTC). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

function dayStart(now: Date, timeZone: string, dayOffset: number): Date {
  const w = wallClock(now, timeZone)
  const utcMidnight = Date.UTC(w.year, w.month - 1, w.day + dayOffset)
  // First guess uses the offset in force at `now`; re-correct once with the
  // offset at the guess itself. They differ only when a DST switch (always at
  // 02:00 local) lies between that midnight and `now`, and one pass fixes it.
  const guess = utcMidnight - zoneOffsetMs(now, timeZone)
  return new Date(utcMidnight - zoneOffsetMs(new Date(guess), timeZone))
}

/** Midnight of `now`'s calendar day in `timeZone`, as a UTC instant. DST-safe. */
export function dayStartInZone(now: Date, timeZone: string): Date {
  return dayStart(now, timeZone, 0)
}

/** The midnight following `now` in `timeZone`, as a UTC instant. */
export function nextDayStartInZone(now: Date, timeZone: string): Date {
  return dayStart(now, timeZone, 1)
}
