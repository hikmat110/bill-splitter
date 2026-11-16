// Read-side queries behind the Mini App admin tab, plus user lookup. Every
// export is a plain aggregate/select; shaping for the wire happens in
// server/admin-routes.ts and the pure bucketing/merging in utils/admin-stats.

import { and, desc, eq, gte, ilike, inArray, like, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { billParticipants, bills, cards, contacts, feedback, scanEvents, users } from '../db/schema'
import type { User } from '../db/schema'
import { config, GEMINI_DEFAULT_BASE_URL } from '../config'
import { GEMINI_QUOTA_ZONE, dayStartInZone, nextDayStartInZone } from '../utils/scan-quota'
import {
  ADMIN_ZONE,
  fillWeeks,
  mergeActivity,
  parseUserQuery,
  weekKeys,
} from '../utils/admin-stats'
import type { WeekBucket } from '../utils/admin-stats'

const DAY_MS = 86_400_000
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS)

/** `count(*) filter (where …)::int` — one row of many counts beats N queries. */
const cnt = (cond: SQL | undefined) =>
  cond ? sql<number>`count(*) filter (where ${cond})::int` : sql<number>`count(*)::int`

// ─── overview ────────────────────────────────────────────────────────────────

export interface OverviewStats {
  users: {
    total: number
    new7d: number
    new30d: number
    active24h: number
    active7d: number
    active30d: number
  }
  languages: { uz: number; ru: number; en: number; other: number }
  bills: { total: number; sent: number; settled: number; volume: number }
  participants: { pending: number; marked_paid: number; confirmed: number; disputed: number }
}

export async function getOverviewStats(now: Date): Promise<OverviewStats> {
  const [userRow, billRow, partRow] = await Promise.all([
    db
      .select({
        total: cnt(undefined),
        new7d: cnt(gte(users.created_at, ago(now, 7))),
        new30d: cnt(gte(users.created_at, ago(now, 30))),
        // Rolling windows over last_seen_at (bumped by both auth paths).
        active24h: cnt(gte(users.last_seen_at, ago(now, 1))),
        active7d: cnt(gte(users.last_seen_at, ago(now, 7))),
        active30d: cnt(gte(users.last_seen_at, ago(now, 30))),
        uz: cnt(eq(users.language_code, 'uz')),
        ru: cnt(eq(users.language_code, 'ru')),
        en: cnt(eq(users.language_code, 'en')),
      })
      .from(users)
      .then((r) => r[0]!),
    db
      .select({
        total: cnt(undefined),
        sent: cnt(eq(bills.status, 'sent')),
        settled: cnt(eq(bills.status, 'settled')),
        // sum(numeric) arrives as a string without the cast.
        volume: sql<number>`coalesce(sum(${bills.total}) filter (where ${inArray(bills.status, ['sent', 'settled'])}), 0)::float8`,
      })
      .from(bills)
      .then((r) => r[0]!),
    db
      .select({
        pending: cnt(eq(billParticipants.status, 'pending')),
        marked_paid: cnt(eq(billParticipants.status, 'marked_paid')),
        confirmed: cnt(eq(billParticipants.status, 'confirmed')),
        disputed: cnt(eq(billParticipants.status, 'disputed')),
      })
      .from(billParticipants)
      .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
      .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
      // A creator never owes themselves (self-participant invariant), so their
      // own share is not part of the payment funnel.
      .where(
        and(
          ne(bills.status, 'draft'),
          sql`${contacts.linked_user_id} is distinct from ${bills.creator_id}`
        )
      )
      .then((r) => r[0]!),
  ])

  return {
    users: {
      total: userRow.total,
      new7d: userRow.new7d,
      new30d: userRow.new30d,
      active24h: userRow.active24h,
      active7d: userRow.active7d,
      active30d: userRow.active30d,
    },
    languages: {
      uz: userRow.uz,
      ru: userRow.ru,
      en: userRow.en,
      other: userRow.total - userRow.uz - userRow.ru - userRow.en,
    },
    bills: billRow,
    participants: partRow,
  }
}

// ─── scan health ─────────────────────────────────────────────────────────────

export interface ScanWindow {
  ok: number
  parse: number
  upstream: number
  pending: number
  /** Mean Gemini round-trip over successful scans; null when there were none. */
  avgMs: number | null
}

export interface ScanHealth {
  configured: boolean
  model: string
  relay: boolean
  dailyLimit: number
  /** Scans counted against today's global quota — same definition as reserveScan. */
  today: number
  resetsAt: Date
  last24h: ScanWindow
  last7d: ScanWindow
}

export async function getScanHealth(now: Date): Promise<ScanHealth> {
  const dayStart = dayStartInZone(now, GEMINI_QUOTA_ZONE)
  const since24h = ago(now, 1)
  const inWindow = (since: Date | null, status: string) =>
    since
      ? and(gte(scanEvents.created_at, since), eq(scanEvents.status, status))
      : eq(scanEvents.status, status)
  const avg = (since: Date | null) =>
    sql<number | null>`avg(${scanEvents.duration_ms}) filter (where ${inWindow(since, 'ok')})::int`

  // One pass over the last 7 days; the quota day always lies inside it.
  const [row] = await db
    .select({
      today: cnt(and(gte(scanEvents.created_at, dayStart), ne(scanEvents.status, 'upstream'))),
      ok24: cnt(inWindow(since24h, 'ok')),
      parse24: cnt(inWindow(since24h, 'parse')),
      upstream24: cnt(inWindow(since24h, 'upstream')),
      pending24: cnt(inWindow(since24h, 'pending')),
      avg24: avg(since24h),
      ok7: cnt(inWindow(null, 'ok')),
      parse7: cnt(inWindow(null, 'parse')),
      upstream7: cnt(inWindow(null, 'upstream')),
      pending7: cnt(inWindow(null, 'pending')),
      avg7: avg(null),
    })
    .from(scanEvents)
    .where(gte(scanEvents.created_at, ago(now, 7)))

  const r = row!
  return {
    configured: !!config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
    relay: config.GEMINI_BASE_URL !== GEMINI_DEFAULT_BASE_URL,
    dailyLimit: config.SCAN_DAILY_GLOBAL_LIMIT,
    today: r.today,
    resetsAt: nextDayStartInZone(now, GEMINI_QUOTA_ZONE),
    last24h: { ok: r.ok24, parse: r.parse24, upstream: r.upstream24, pending: r.pending24, avgMs: r.avg24 },
    last7d: { ok: r.ok7, parse: r.parse7, upstream: r.upstream7, pending: r.pending7, avgMs: r.avg7 },
  }
}

// ─── weekly trends ───────────────────────────────────────────────────────────

export interface WeeklyTrends {
  signups: WeekBucket[]
  bills: WeekBucket[]
}

/** Monday-start week label in ADMIN_ZONE; must agree with utils/admin-stats
 *  weekKeys. The zone is inlined (it is a compile-time constant, not user
 *  input): as a bound parameter it would get a different placeholder in
 *  SELECT and GROUP BY, and Postgres would then refuse to match the two. */
const weekOf = (col: SQL | { getSQL(): SQL }) =>
  sql<string>`to_char(date_trunc('week', ${col} at time zone ${sql.raw(`'${ADMIN_ZONE}'`)}), 'YYYY-MM-DD')`

export async function getWeeklyTrends(now: Date, weeks = 12): Promise<WeeklyTrends> {
  const keys = weekKeys(now, ADMIN_ZONE, weeks)
  const since = ago(now, weeks * 7)

  // GROUP BY 1 (the week expression) — positional, so it can never drift from
  // the SELECT expression.
  const [signups, billRows] = await Promise.all([
    db
      .select({ week: weekOf(users.created_at), count: cnt(undefined) })
      .from(users)
      .where(gte(users.created_at, since))
      .groupBy(sql`1`),
    db
      .select({ week: weekOf(bills.created_at), count: cnt(undefined) })
      .from(bills)
      .where(and(gte(bills.created_at, since), ne(bills.status, 'draft')))
      .groupBy(sql`1`),
  ])

  return { signups: fillWeeks(signups, keys), bills: fillWeeks(billRows, keys) }
}

// ─── recent activity ─────────────────────────────────────────────────────────

export interface Actor {
  id: string
  firstName: string
  username: string | null
}

export type ActivityItem =
  | { kind: 'signup'; at: Date; user: Actor }
  | { kind: 'bill'; at: Date; user: Actor; billId: string; title: string; total: number; status: string }
  | { kind: 'scan'; at: Date; user: Actor; status: string; durationMs: number | null }
  | { kind: 'feedback'; at: Date; user: Actor; feedbackId: string; category: string; status: string }

const actor = { id: users.id, firstName: users.first_name, username: users.username }

/** Newest `limit` events across signups, sent bills, scans, and feedback. Four
 *  cheap top-N reads merged in memory — no unions, no cross-table sort. */
export async function getRecentActivity(limit = 20): Promise<ActivityItem[]> {
  const [signups, sentBills, scans, reports] = await Promise.all([
    db
      .select({ at: users.created_at, user: actor })
      .from(users)
      .orderBy(desc(users.created_at))
      .limit(limit),
    db
      .select({
        at: bills.created_at,
        user: actor,
        billId: bills.id,
        title: bills.title,
        total: bills.total,
        status: bills.status,
      })
      .from(bills)
      .innerJoin(users, eq(bills.creator_id, users.id))
      .where(ne(bills.status, 'draft'))
      .orderBy(desc(bills.created_at))
      .limit(limit),
    db
      .select({
        at: scanEvents.created_at,
        user: actor,
        status: scanEvents.status,
        durationMs: scanEvents.duration_ms,
      })
      .from(scanEvents)
      .innerJoin(users, eq(scanEvents.user_id, users.id))
      .orderBy(desc(scanEvents.created_at))
      .limit(limit),
    db
      .select({
        at: feedback.created_at,
        user: actor,
        feedbackId: feedback.id,
        category: feedback.category,
        status: feedback.status,
      })
      .from(feedback)
      .innerJoin(users, eq(feedback.user_id, users.id))
      .orderBy(desc(feedback.created_at))
      .limit(limit),
  ])

  return mergeActivity<ActivityItem>(
    [
      signups.map((r) => ({ kind: 'signup' as const, ...r })),
      sentBills.map((r) => ({ kind: 'bill' as const, ...r })),
      scans.map((r) => ({ kind: 'scan' as const, ...r })),
      reports.map((r) => ({ kind: 'feedback' as const, ...r })),
    ],
    limit
  )
}

// ─── users ───────────────────────────────────────────────────────────────────

/** Free-text lookup by name, @username, phone digits, or exact Telegram id.
 *  An empty query lists the most recent signups. */
export async function searchUsers(q: string, limit = 20): Promise<User[]> {
  const parsed = parseUserQuery(q)
  const conds: SQL[] = []
  if (parsed.like) {
    conds.push(
      ilike(users.first_name, parsed.like),
      ilike(users.last_name, parsed.like),
      ilike(users.username, parsed.like)
    )
  }
  if (parsed.phoneLike) conds.push(like(users.phone, parsed.phoneLike))
  if (parsed.telegramId !== null) conds.push(eq(users.telegram_id, parsed.telegramId))

  return db
    .select()
    .from(users)
    .where(conds.length > 0 ? or(...conds) : undefined)
    .orderBy(desc(users.created_at))
    .limit(limit)
}

export interface UserDetail {
  user: User
  counts: {
    billsCreated: number
    /** Bills sent TO this user — same rule as listBillsForParticipant. */
    billsReceived: number
    /** Scans that consumed quota (everything but 'upstream'), all time. */
    scansUsed: number
    cards: number
    feedback: number
  }
}

export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return null

  // Separate bound counts rather than correlated subqueries: in a single-table
  // select drizzle renders the outer column unqualified, so `users.id` inside
  // the subquery would silently resolve to the inner table's own `id`.
  const first = (rows: { count: number }[]) => rows[0]?.count ?? 0
  const [billsCreated, billsReceived, scansUsed, cardCount, feedbackCount] = await Promise.all([
    db.select({ count: cnt(undefined) }).from(bills).where(eq(bills.creator_id, userId)).then(first),
    db
      .select({ count: cnt(undefined) })
      .from(billParticipants)
      .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
      .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
      .where(and(eq(contacts.linked_user_id, userId), ne(bills.creator_id, userId)))
      .then(first),
    db
      .select({ count: cnt(undefined) })
      .from(scanEvents)
      .where(and(eq(scanEvents.user_id, userId), ne(scanEvents.status, 'upstream')))
      .then(first),
    db.select({ count: cnt(undefined) }).from(cards).where(eq(cards.user_id, userId)).then(first),
    db.select({ count: cnt(undefined) }).from(feedback).where(eq(feedback.user_id, userId)).then(first),
  ])

  return {
    user,
    counts: { billsCreated, billsReceived, scansUsed, cards: cardCount, feedback: feedbackCount },
  }
}
