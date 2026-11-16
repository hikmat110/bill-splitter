// /api/admin/* — the Mini App admin tab. Every route here is admin-only, so the
// guard runs once at the top (a non-admin gets 403 for any path, and learns
// nothing about which paths exist). Thin adapters over admin.service, like
// routes.ts is over the other services.

import { z } from 'zod'
import type { Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import type { User } from '../db/schema'
import { config } from '../config'
import { isAdmin } from './authz'
import { json, error } from './json'
import { adminMessageSchema } from './schemas'
import {
  getOverviewStats,
  getRecentActivity,
  getScanHealth,
  getUserDetail,
  getWeeklyTrends,
  searchUsers,
} from '../services/admin.service'
import type { ActivityItem } from '../services/admin.service'
import { countFeedback } from '../services/feedback.service'
import {
  countUnread,
  listThread,
  listThreads,
  markRead,
  recordOutbound,
} from '../services/support.service'
import type { SupportThread } from '../services/support.service'
import { findById } from '../services/user.service'
import { sendAdminMessage } from '../services/notification.service'
import type { SupportMessage } from '../db/schema'
import type { SendFailureCode } from '../utils/telegram-errors'

export async function handleAdmin(
  req: Request,
  url: URL,
  user: User,
  seg: string[],
  bot: Bot<MyContext>
): Promise<Response> {
  if (!isAdmin(user, config.ADMIN_TELEGRAM_IDS)) return error(403, 'Forbidden')
  const method = req.method

  // GET /api/admin/stats — overview + scan health + weekly trends + open feedback
  if (seg[0] === 'stats' && seg.length === 1 && method === 'GET') return await getStats()

  // GET /api/admin/activity?limit=20
  if (seg[0] === 'activity' && seg.length === 1 && method === 'GET') return await getActivity(url)

  // GET /api/admin/support/threads?limit=30 — the support inbox
  if (seg[0] === 'support' && seg[1] === 'threads' && seg.length === 2 && method === 'GET') {
    return await getSupportThreads(url)
  }

  if (seg[0] === 'users') {
    // GET /api/admin/users?q=
    if (seg.length === 1 && method === 'GET') return await getUsers(url)
    if (seg.length >= 2) {
      // A malformed id is a 404, not a Postgres uuid-cast 500.
      const id = z.uuid().safeParse(seg[1])
      if (!id.success) return error(404, 'User not found')
      // GET /api/admin/users/:id
      if (seg.length === 2 && method === 'GET') return await getUser(id.data)
      // POST /api/admin/users/:id/message
      if (seg.length === 3 && seg[2] === 'message' && method === 'POST') {
        return await postMessage(req, id.data, user, bot)
      }
      // GET /api/admin/users/:id/messages?before=<iso>&limit=50
      if (seg.length === 3 && seg[2] === 'messages' && method === 'GET') {
        return await getSupportThread(url, id.data)
      }
    }
  }

  return error(404, 'Not found')
}

// ─── shapers ─────────────────────────────────────────────────────────────────

function shapeUser(u: User) {
  return {
    id: u.id,
    // bigint → number via json()'s replacer; Telegram ids are well under 2^53.
    telegramId: u.telegram_id,
    firstName: u.first_name,
    lastName: u.last_name,
    username: u.username,
    phone: u.phone,
    languageCode: u.language_code,
    createdAt: u.created_at.toISOString(),
    lastSeenAt: u.last_seen_at?.toISOString() ?? null,
  }
}

function shapeSupportMessage(m: SupportMessage) {
  return {
    id: m.id,
    direction: m.direction,
    text: m.text,
    attachmentId: m.attachment_id,
    attachmentMime: m.attachment_mime,
    adminUserId: m.admin_user_id,
    failureCode: m.failure_code,
    readAt: m.read_at?.toISOString() ?? null,
    createdAt: m.created_at.toISOString(),
  }
}

function shapeThread(th: SupportThread) {
  return {
    user: shapeUser(th.user),
    lastMessage: shapeSupportMessage(th.lastMessage),
    unread: th.unread,
  }
}

function shapeActivity(item: ActivityItem) {
  return { ...item, at: item.at.toISOString() }
}

// ─── handlers ────────────────────────────────────────────────────────────────

async function getStats(): Promise<Response> {
  const now = new Date()
  const [overview, scans, trends, open, unreadSupport] = await Promise.all([
    getOverviewStats(now),
    getScanHealth(now),
    getWeeklyTrends(now),
    countFeedback('open'),
    countUnread(),
  ])
  return json({
    generatedAt: now.toISOString(),
    overview,
    scans: { ...scans, resetsAt: scans.resetsAt.toISOString() },
    trends,
    feedback: { open },
    support: { unread: unreadSupport },
  })
}

async function getActivity(url: URL): Promise<Response> {
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20))
  const items = await getRecentActivity(limit)
  return json({ items: items.map(shapeActivity) })
}

async function getUsers(url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').slice(0, 100)
  const items = await searchUsers(q)
  return json({ items: items.map(shapeUser) })
}

async function getUser(id: string): Promise<Response> {
  const detail = await getUserDetail(id)
  if (!detail) return error(404, 'User not found')
  return json({ ...shapeUser(detail.user), counts: detail.counts })
}

const SEND_FAILURE: Record<SendFailureCode, { status: number; message: string }> = {
  blocked: { status: 409, message: 'This user has blocked the bot' },
  chat_not_found: { status: 409, message: 'Telegram has no chat with this user' },
  rate_limited: { status: 429, message: 'Telegram rate limit hit — try again shortly' },
  send_failed: { status: 502, message: 'Telegram rejected the message' },
}

async function postMessage(
  req: Request,
  id: string,
  admin: User,
  bot: Bot<MyContext>
): Promise<Response> {
  const body = adminMessageSchema.parse(await req.json())
  const target = await findById(id)
  if (!target) return error(404, 'User not found')

  const result = await sendAdminMessage(bot, target, body.text)

  // Recorded either way: a refused message stays in the thread as an
  // undelivered bubble instead of vanishing.
  const row = await recordOutbound(target.id, admin.id, {
    text: body.text,
    tgMessageId: result.ok ? result.messageId : null,
    failureCode: result.ok ? null : result.code,
  })

  if (result.ok) return json({ ok: true, message: shapeSupportMessage(row) })
  const failure = SEND_FAILURE[result.code]
  // The row goes out with the error too, so the thread can render it as an
  // undelivered bubble instead of dropping what the admin typed.
  return json(
    { error: failure.message, code: result.code, message: shapeSupportMessage(row) },
    { status: failure.status }
  )
}

const THREAD_PAGE_MAX = 100

async function getSupportThread(url: URL, userId: string): Promise<Response> {
  const limit = Math.min(
    THREAD_PAGE_MAX,
    Math.max(1, Number(url.searchParams.get('limit')) || 50)
  )
  const rawBefore = url.searchParams.get('before')
  const parsedBefore = rawBefore ? new Date(rawBefore) : null
  const before =
    parsedBefore && !Number.isNaN(parsedBefore.getTime()) ? parsedBefore : undefined

  const { items, hasMore } = await listThread(userId, { before, limit })

  // Opening the thread marks it read — only the rows on this page, and only
  // when there are any, so the 5s poll is a pure read after the first tick.
  const unreadIds = items
    .filter((m) => m.direction === 'in' && m.read_at === null)
    .map((m) => m.id)
  if (unreadIds.length > 0) await markRead(unreadIds)

  return json({ items: items.map(shapeSupportMessage), hasMore })
}

async function getSupportThreads(url: URL): Promise<Response> {
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30))
  const threads = await listThreads(limit)
  return json({ items: threads.map(shapeThread) })
}
