import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { supportMessages, users } from '../db/schema'
import type { SupportMessage, User } from '../db/schema'
import type { SendFailureCode } from '../utils/telegram-errors'

/** Per-user cap on inbound support messages per rolling 24 h — cheap spam
 *  guard, mirroring FEEDBACK_DAILY_LIMIT. */
export const SUPPORT_DAILY_LIMIT = 30

/** Thrown by recordInbound when the user hit SUPPORT_DAILY_LIMIT. */
export class SupportLimitError extends Error {
  constructor() {
    super(`A user can send at most ${SUPPORT_DAILY_LIMIT} support messages per day`)
    this.name = 'SupportLimitError'
  }
}

export interface InboundInput {
  text: string
  attachmentId?: string | null
  attachmentMime?: string | null
  tgMessageId?: number | null
}

export interface OutboundInput {
  text: string
  tgMessageId?: number | null
  failureCode?: SendFailureCode | null
}

/** One row of the admin's support inbox. */
export interface SupportThread {
  user: User
  lastMessage: SupportMessage
  unread: number
}

/**
 * Record a message the user sent to the bot. Returns the stored row plus the
 * timestamp of their *previous* inbound message, which the caller uses to
 * decide whether to ack and whether to ping admins (see utils/support).
 */
export async function recordInbound(
  userId: string,
  input: InboundInput
): Promise<{ message: SupportMessage; lastInboundAt: Date | null }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportMessages)
    .where(
      and(
        eq(supportMessages.user_id, userId),
        eq(supportMessages.direction, 'in'),
        gte(supportMessages.created_at, cutoff)
      )
    )
  if ((counted?.count ?? 0) >= SUPPORT_DAILY_LIMIT) throw new SupportLimitError()

  const [previous] = await db
    .select({ created_at: supportMessages.created_at })
    .from(supportMessages)
    .where(and(eq(supportMessages.user_id, userId), eq(supportMessages.direction, 'in')))
    .orderBy(desc(supportMessages.created_at))
    .limit(1)

  const [row] = await db
    .insert(supportMessages)
    .values({
      user_id: userId,
      direction: 'in',
      text: input.text,
      attachment_id: input.attachmentId ?? null,
      attachment_mime: input.attachmentMime ?? null,
      tg_message_id: input.tgMessageId != null ? BigInt(input.tgMessageId) : null,
    })
    .returning()
  if (!row) throw new Error('Failed to insert support message')

  return { message: row, lastInboundAt: previous?.created_at ?? null }
}

/**
 * Record an admin reply. Written even when Telegram refused it (failureCode
 * set), so the thread shows an undelivered bubble rather than losing the text.
 */
export async function recordOutbound(
  userId: string,
  adminUserId: string,
  input: OutboundInput
): Promise<SupportMessage> {
  const [row] = await db
    .insert(supportMessages)
    .values({
      user_id: userId,
      direction: 'out',
      text: input.text,
      admin_user_id: adminUserId,
      tg_message_id: input.tgMessageId != null ? BigInt(input.tgMessageId) : null,
      failure_code: input.failureCode ?? null,
    })
    .returning()
  if (!row) throw new Error('Failed to insert support message')
  return row
}

/**
 * One user's thread, oldest first (chat order). `before` pages backwards: pass
 * the oldest loaded message's created_at to fetch the page before it.
 */
export async function listThread(
  userId: string,
  opts: { before?: Date; limit: number }
): Promise<{ items: SupportMessage[]; hasMore: boolean }> {
  const conds = [eq(supportMessages.user_id, userId)]
  if (opts.before) conds.push(lt(supportMessages.created_at, opts.before))

  // Fetch newest-first so `before` pages backwards, then reverse for display.
  const rows = await db
    .select()
    .from(supportMessages)
    .where(and(...conds))
    .orderBy(desc(supportMessages.created_at))
    .limit(opts.limit + 1)

  const hasMore = rows.length > opts.limit
  return { items: rows.slice(0, opts.limit).reverse(), hasMore }
}

/**
 * Mark exactly these inbound messages as seen. Takes explicit ids rather than a
 * blanket `user_id + read_at is null` predicate: a message arriving between the
 * thread SELECT and this UPDATE must stay unread, since the admin never saw it.
 */
export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(supportMessages)
    .set({ read_at: new Date() })
    .where(and(inArray(supportMessages.id, ids), isNull(supportMessages.read_at)))
}

/** Total unread inbound messages — the admin tab's support badge. */
export async function countUnread(): Promise<number> {
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportMessages)
    .where(and(eq(supportMessages.direction, 'in'), isNull(supportMessages.read_at)))
  return counted?.count ?? 0
}

/**
 * The admin inbox: one entry per user who has ever exchanged a message, most
 * recent activity first, with that user's last message and unread count.
 */
export async function listThreads(limit: number): Promise<SupportThread[]> {
  // Grouped once to pick the users and their unread counts; the last message and
  // the user rows are then two bounded lookups. Kept as separate statements
  // because drizzle renders an outer column unqualified inside a subquery.
  const agg = await db
    .select({
      user_id: supportMessages.user_id,
      unread: sql<number>`count(*) filter (
        where ${supportMessages.direction} = 'in' and ${supportMessages.read_at} is null
      )::int`,
    })
    .from(supportMessages)
    .groupBy(supportMessages.user_id)
    .orderBy(desc(sql`max(${supportMessages.created_at})`))
    .limit(limit)

  const userIds = agg.map((a) => a.user_id)
  if (userIds.length === 0) return []

  const [lastRows, userRows] = await Promise.all([
    db
      .selectDistinctOn([supportMessages.user_id])
      .from(supportMessages)
      .where(inArray(supportMessages.user_id, userIds))
      .orderBy(supportMessages.user_id, desc(supportMessages.created_at)),
    db.select().from(users).where(inArray(users.id, userIds)),
  ])

  const lastById = new Map(lastRows.map((r) => [r.user_id, r]))
  const userById = new Map(userRows.map((u) => [u.id, u]))

  const threads: SupportThread[] = []
  for (const a of agg) {
    const lastMessage = lastById.get(a.user_id)
    const user = userById.get(a.user_id)
    if (!lastMessage || !user) continue
    threads.push({ user, lastMessage, unread: a.unread })
  }
  // agg was ordered by max(created_at); keep that order explicitly so the list
  // stays stable regardless of how the two lookups came back.
  threads.sort((x, y) => y.lastMessage.created_at.getTime() - x.lastMessage.created_at.getTime())
  return threads
}

/** Reverse lookup for GET /api/files/:id — which support message owns this. */
export async function findSupportAttachment(
  attachmentId: string
): Promise<SupportMessage | null> {
  const [row] = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.attachment_id, attachmentId))
    .limit(1)
  return row ?? null
}
