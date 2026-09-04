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
import { findById } from '../services/user.service'
import { sendAdminMessage } from '../services/notification.service'
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
        return await postMessage(req, id.data, bot)
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

function shapeActivity(item: ActivityItem) {
  return { ...item, at: item.at.toISOString() }
}

// ─── handlers ────────────────────────────────────────────────────────────────

async function getStats(): Promise<Response> {
  const now = new Date()
  const [overview, scans, trends, open] = await Promise.all([
    getOverviewStats(now),
    getScanHealth(now),
    getWeeklyTrends(now),
    countFeedback('open'),
  ])
  return json({
    generatedAt: now.toISOString(),
    overview,
    scans: { ...scans, resetsAt: scans.resetsAt.toISOString() },
    trends,
    feedback: { open },
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

async function postMessage(req: Request, id: string, bot: Bot<MyContext>): Promise<Response> {
  const body = adminMessageSchema.parse(await req.json())
  const target = await findById(id)
  if (!target) return error(404, 'User not found')

  const result = await sendAdminMessage(bot, target, body.text)
  if (result.ok) return json({ ok: true })
  const failure = SEND_FAILURE[result.code]
  return json({ error: failure.message, code: result.code }, { status: failure.status })
}
