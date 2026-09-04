import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { feedback, feedbackAttachments, users } from '../db/schema'
import type { Feedback, FeedbackAttachment } from '../db/schema'

/** Per-user cap on submissions per rolling 24 h — cheap spam guard. */
export const FEEDBACK_DAILY_LIMIT = 20

/** Thrown by createFeedback when the user hit FEEDBACK_DAILY_LIMIT. */
export class FeedbackLimitError extends Error {
  constructor() {
    super(`A user can submit at most ${FEEDBACK_DAILY_LIMIT} feedback per day`)
    this.name = 'FeedbackLimitError'
  }
}

export interface FeedbackAttachmentInput {
  attachmentId: string
  mime: string
  isAutoCapture: boolean
}

export interface CreateFeedbackInput {
  category: string
  message: string
  screen: string
  buildId: string
  platform: string
  tgVersion: string
  language: string
  attachments: FeedbackAttachmentInput[]
}

/** Who submitted, for the admin list/DM — a slice of the users row. */
export interface FeedbackReporter {
  first_name: string
  last_name: string | null
  username: string | null
  telegram_id: bigint
}

export type FeedbackWithDetails = Feedback & {
  reporter: FeedbackReporter
  attachments: FeedbackAttachment[]
}

export interface FeedbackListFilter {
  status?: string
  category?: string
  offset: number
  limit: number
}

const reporterColumns = {
  first_name: users.first_name,
  last_name: users.last_name,
  username: users.username,
  telegram_id: users.telegram_id,
}

async function attachmentsByFeedbackIds(
  ids: string[]
): Promise<Map<string, FeedbackAttachment[]>> {
  const map = new Map<string, FeedbackAttachment[]>()
  if (ids.length === 0) return map
  const rows = await db
    .select()
    .from(feedbackAttachments)
    .where(inArray(feedbackAttachments.feedback_id, ids))
    .orderBy(asc(feedbackAttachments.position))
  for (const row of rows) {
    const list = map.get(row.feedback_id) ?? []
    list.push(row)
    map.set(row.feedback_id, list)
  }
  return map
}

export async function createFeedback(
  userId: string,
  input: CreateFeedbackInput
): Promise<{ feedback: Feedback; attachments: FeedbackAttachment[] }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recent = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedback)
    .where(and(eq(feedback.user_id, userId), gte(feedback.created_at, cutoff)))
  if ((recent[0]?.count ?? 0) >= FEEDBACK_DAILY_LIMIT) throw new FeedbackLimitError()

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(feedback)
      .values({
        user_id: userId,
        category: input.category,
        message: input.message,
        screen: input.screen,
        build_id: input.buildId,
        platform: input.platform,
        tg_version: input.tgVersion,
        language: input.language,
      })
      .returning()
    if (!row) throw new Error('Failed to insert feedback')

    let attachments: FeedbackAttachment[] = []
    if (input.attachments.length > 0) {
      attachments = await tx
        .insert(feedbackAttachments)
        .values(
          input.attachments.map((a, i) => ({
            feedback_id: row.id,
            attachment_id: a.attachmentId,
            mime: a.mime,
            is_auto_capture: a.isAutoCapture,
            position: i,
          }))
        )
        .returning()
    }
    return { feedback: row, attachments }
  })
}

function feedbackFilters(filter: { status?: string; category?: string }) {
  const conds = []
  if (filter.status) conds.push(eq(feedback.status, filter.status))
  if (filter.category) conds.push(eq(feedback.category, filter.category))
  return conds.length > 0 ? and(...conds) : undefined
}

/** Admin list, newest first, with reporter + attachments. */
export async function listFeedback(
  filter: FeedbackListFilter
): Promise<{ items: FeedbackWithDetails[]; total: number }> {
  const where = feedbackFilters(filter)
  const rows = await db
    .select({ feedback: feedback, reporter: reporterColumns })
    .from(feedback)
    .innerJoin(users, eq(feedback.user_id, users.id))
    .where(where)
    .orderBy(desc(feedback.created_at))
    .offset(filter.offset)
    .limit(filter.limit)

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedback)
    .where(where)

  const byId = await attachmentsByFeedbackIds(rows.map((r) => r.feedback.id))
  return {
    items: rows.map((r) => ({
      ...r.feedback,
      reporter: r.reporter,
      attachments: byId.get(r.feedback.id) ?? [],
    })),
    total: counted?.count ?? 0,
  }
}

export async function getFeedbackById(id: string): Promise<FeedbackWithDetails | null> {
  const rows = await db
    .select({ feedback: feedback, reporter: reporterColumns })
    .from(feedback)
    .innerJoin(users, eq(feedback.user_id, users.id))
    .where(eq(feedback.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const byId = await attachmentsByFeedbackIds([row.feedback.id])
  return {
    ...row.feedback,
    reporter: row.reporter,
    attachments: byId.get(row.feedback.id) ?? [],
  }
}

export async function updateFeedbackStatus(
  id: string,
  status: string
): Promise<Feedback | null> {
  const [updated] = await db
    .update(feedback)
    .set({ status })
    .where(eq(feedback.id, id))
    .returning()
  return updated ?? null
}

/** Reverse lookup for GET /api/files/:id — which feedback owns this attachment. */
export async function findFeedbackAttachment(
  attachmentId: string
): Promise<{ feedback: Feedback; attachment: FeedbackAttachment } | null> {
  const rows = await db
    .select({ feedback: feedback, attachment: feedbackAttachments })
    .from(feedbackAttachments)
    .innerJoin(feedback, eq(feedbackAttachments.feedback_id, feedback.id))
    .where(eq(feedbackAttachments.attachment_id, attachmentId))
    .limit(1)
  return rows[0] ?? null
}

/** How many feedback rows sit in `status` — the admin tab's inbox badge. */
export async function countFeedback(status: string): Promise<number> {
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedback)
    .where(eq(feedback.status, status))
  return counted?.count ?? 0
}
