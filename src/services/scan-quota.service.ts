import { and, eq, gt, gte, ne, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { scanEvents } from '../db/schema'
import { config } from '../config'
import { rootLogger } from '../bot/middleware/logger'
import {
  GEMINI_QUOTA_ZONE,
  dayStartInZone,
  decideScanQuota,
  type ScanLimitCode,
} from '../utils/scan-quota'
import { ReceiptScanError, scanReceipt } from './receipt-scan.service'
import type { ScannedReceipt } from './receipt-scan.service'
import type { AllowedMime } from './storage.service'

const log = rootLogger.child({ module: 'scan-quota' })

/** Thrown by scanReceiptForUser BEFORE calling Gemini when a limit is hit → 429. */
export class ScanLimitError extends Error {
  constructor(
    public code: ScanLimitCode,
    /** When a scan is next admitted. */
    public retryAt: Date,
    /** The limit that was hit: the per-user count, or the global daily cap. */
    public limit: number,
    /** The window that limit applies to: config hours, or 24 for the Pacific day. */
    public windowHours: number
  ) {
    super(
      code === 'user_limit'
        ? `Scan limit reached: ${limit} scans per ${windowHours} h`
        : "Today's scanning quota is used up"
    )
    this.name = 'ScanLimitError'
  }
}

type ScanOutcome = 'ok' | 'parse' | 'upstream'

// Rows tagged 'upstream' never consumed Google's quota, so they don't count.
// 'pending' rows (in flight) do — that is what makes concurrent requests count.
const counted = ne(scanEvents.status, 'upstream')

/**
 * Check both limits and reserve a scan_events row. Check-then-insert is not
 * atomic: two truly simultaneous requests from one user can both pass and land
 * limit+1 rows in the window. Accepted — the Scan button is disabled while a
 * scan is in flight, the window self-corrects on the next request, and the
 * global cap keeps headroom under Google's 500 RPD. If limits ever grow large
 * enough to matter, wrap this in db.transaction with
 * `select pg_advisory_xact_lock(hashtext(userId))` before the per-user query.
 */
async function reserveScan(userId: string): Promise<string> {
  const now = new Date()
  const userLimit = config.SCAN_RATE_LIMIT_PER_USER
  const windowMs = config.SCAN_RATE_LIMIT_WINDOW_HOURS * 3_600_000
  const globalLimit = config.SCAN_DAILY_GLOBAL_LIMIT

  const userEvents =
    userLimit > 0
      ? (
          await db
            .select({ created_at: scanEvents.created_at })
            .from(scanEvents)
            .where(
              and(
                eq(scanEvents.user_id, userId),
                gt(scanEvents.created_at, new Date(now.getTime() - windowMs)),
                counted
              )
            )
        ).map((r) => r.created_at)
      : []

  const globalCount =
    globalLimit > 0
      ? ((
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(scanEvents)
            .where(and(gte(scanEvents.created_at, dayStartInZone(now, GEMINI_QUOTA_ZONE)), counted))
        )[0]?.count ?? 0)
      : 0

  const decision = decideScanQuota({ userEvents, userLimit, windowMs, globalCount, globalLimit, now })
  if (!decision.ok) {
    log.warn({ userId, code: decision.code, retryAt: decision.retryAt }, 'Scan rate-limited')
    throw decision.code === 'user_limit'
      ? new ScanLimitError('user_limit', decision.retryAt, userLimit, config.SCAN_RATE_LIMIT_WINDOW_HOURS)
      : new ScanLimitError('global_limit', decision.retryAt, globalLimit, 24)
  }

  const [row] = await db
    .insert(scanEvents)
    .values({ user_id: userId, model: config.GEMINI_MODEL })
    .returning({ id: scanEvents.id })
  return row!.id
}

async function settleScan(eventId: string, status: ScanOutcome, durationMs: number): Promise<void> {
  await db
    .update(scanEvents)
    .set({ status, duration_ms: durationMs })
    .where(eq(scanEvents.id, eventId))
}

/**
 * Rate-limited receipt scan: reserve a scan_events row, call Gemini, then
 * record how it went. Throws ScanLimitError before the call when a limit is
 * hit; otherwise rethrows whatever scanReceipt threw. Settling is best-effort —
 * a DB hiccup after a good scan must not turn it into a 500.
 */
export async function scanReceiptForUser(
  userId: string,
  bytes: Uint8Array,
  mime: AllowedMime
): Promise<ScannedReceipt> {
  const eventId = await reserveScan(userId)
  const started = Date.now()
  const settle = (status: ScanOutcome) =>
    settleScan(eventId, status, Date.now() - started).catch((err) =>
      log.error({ err, eventId, status }, 'Failed to settle scan event')
    )
  try {
    const result = await scanReceipt(bytes, mime)
    await settle('ok')
    return result
  } catch (e) {
    // 'parse' = Google answered 200 with unusable content → its RPD was consumed,
    // the row keeps counting. Anything else ('upstream', 'not_configured', or an
    // unexpected throw) never produced a Google response → refund the slot.
    await settle(e instanceof ReceiptScanError && e.code === 'parse' ? 'parse' : 'upstream')
    throw e
  }
}
