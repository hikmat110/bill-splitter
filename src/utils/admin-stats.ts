/**
 * Pure helpers behind the admin tab — week bucketing, feed merging, and user
 * search parsing. No DB, no config, so they are unit-testable; the queries
 * that feed them live in services/admin.service.ts.
 */

/** Zone the weekly trend buckets are cut in (CLAUDE.md: display in Tashkent). */
export const ADMIN_ZONE = 'Asia/Tashkent'

export interface WeekBucket {
  /** Monday of the week as YYYY-MM-DD in ADMIN_ZONE. */
  week: string
  count: number
}

const DAY_MS = 86_400_000
const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Calendar date + ISO weekday (Mon=1..Sun=7) of `date` in `timeZone`. */
function wallDate(date: Date, timeZone: string): { y: number; m: number; d: number; dow: number } {
  const out = { y: 0, m: 0, d: 0, dow: 1 }
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type === 'year') out.y = Number(part.value)
    else if (part.type === 'month') out.m = Number(part.value)
    else if (part.type === 'day') out.d = Number(part.value)
    else if (part.type === 'weekday') out.dow = WEEKDAY_INDEX[part.value] ?? 1
  }
  return out
}

/**
 * Monday-start week labels, oldest first, ending with the week that contains
 * `now` (in `timeZone`). Must match the SQL side exactly:
 * `to_char(date_trunc('week', created_at at time zone '<zone>'), 'YYYY-MM-DD')`
 * — Postgres weeks also start on Monday.
 */
export function weekKeys(now: Date, timeZone: string, weeks: number): string[] {
  const w = wallDate(now, timeZone)
  // Calendar math on a UTC-midnight stand-in for the local date: only y/m/d
  // matter, and UTC has no DST so day arithmetic stays exact.
  const monday = Date.UTC(w.y, w.m - 1, w.d - (w.dow - 1))
  const keys: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    keys.push(new Date(monday - i * 7 * DAY_MS).toISOString().slice(0, 10))
  }
  return keys
}

/** Zero-fill `rows` onto `keys`; rows outside the key range (e.g. the partial
 *  13th week a coarse WHERE lets through) are dropped. */
export function fillWeeks(rows: readonly WeekBucket[], keys: readonly string[]): WeekBucket[] {
  const byWeek = new Map(rows.map((r) => [r.week, r.count]))
  return keys.map((week) => ({ week, count: byWeek.get(week) ?? 0 }))
}

/** Merge several newest-first sources into one feed, newest first. */
export function mergeActivity<T extends { at: Date }>(sources: readonly (readonly T[])[], limit: number): T[] {
  return sources
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, Math.max(0, limit))
}

/** Escape LIKE/ILIKE metacharacters (Postgres' default escape is backslash). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export interface UserQuery {
  /** `%…%` pattern for name/username ILIKE, or null when the query is empty. */
  like: string | null
  /** `%…%` over the digits only, for the E.164 phone column; null if < 3 digits. */
  phoneLike: string | null
  /** Exact Telegram id match when the query is purely numeric (5+ digits). */
  telegramId: bigint | null
}

/** Turn free text from the admin search box into the pieces the query needs. */
export function parseUserQuery(raw: string): UserQuery {
  const q = raw.trim().replace(/^@/, '')
  if (!q) return { like: null, phoneLike: null, telegramId: null }
  const digits = q.replace(/\D/g, '')
  return {
    like: `%${escapeLike(q)}%`,
    phoneLike: digits.length >= 3 ? `%${digits}%` : null,
    telegramId: /^\d{5,}$/.test(q) ? BigInt(q) : null,
  }
}
