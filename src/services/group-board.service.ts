// The one group message per split, and everything that redraws it.
//
// A split's card and its payment board are the same Telegram message, edited in
// place as the split moves collecting → building → sent → settled. Keeping it
// to one message is what makes the feature tolerable in a busy chat.

import type { Bot, InlineKeyboard } from 'grammy'
import type { MyContext } from '../bot/index'
import type { GroupSplit } from '../db/schema'
import { rootLogger } from '../bot/middleware/logger'
import { t, type I18nKey } from '../i18n'
import { classifySendError } from '../utils/telegram-errors'
import { decideBoardEdit } from '../utils/board-throttle'
import {
  renderSplitCard,
  renderPaymentBoard,
  type BoardParticipant,
  type RosterMember,
} from '../utils/board-render'
import { splitCardKeyboard, paymentBoardKeyboard } from '../bot/keyboards'
import {
  getSplitDetails,
  findSplitByBillId,
  markBoardEdited,
  cancelSplitsForChat,
} from './group-split.service'
import { getBillWithDetails, getParticipantById } from './bill.service'

const log = rootLogger.child({ module: 'group-board' })

/**
 * Context shim for code paths with no live update — a payment confirmed in the
 * Mini App still has to redraw a board in a group. Carries only what the
 * renderers and group keyboards touch: the bot's username and a language.
 * Same trick as i18n's langCtx, one field wider.
 */
function boardCtx(bot: Bot<MyContext>, lang: string): MyContext {
  return {
    me: bot.botInfo,
    from: { language_code: lang },
  } as unknown as MyContext
}

export interface RenderedBoard {
  text: string
  keyboard: InlineKeyboard | undefined
}

/** Build the current message body for a split, whatever state it is in. */
export async function renderBoard(
  bot: Bot<MyContext>,
  splitId: string
): Promise<{ split: GroupSplit; rendered: RenderedBoard } | null> {
  const details = await getSplitDetails(splitId)
  if (!details) return null

  const { split, creator, members } = details
  const ctx = boardCtx(bot, creator.language_code)
  const tr = (key: I18nKey, vars?: Record<string, string>) => t(ctx, key, vars)
  const hostName = creator.first_name
  const title = split.title ?? tr('group.default_title')

  // Once a bill exists the message becomes the payment board.
  if (split.bill_id) {
    const bill = await getBillWithDetails(split.bill_id)
    if (bill) {
      // The roster already knows everyone's telegram id and username, so the
      // board can mention people without re-querying users.
      const byContact = new Map(
        members.filter((m) => m.contact_id).map((m) => [m.contact_id!, m])
      )
      const participants: BoardParticipant[] = bill.participants.map((p) => {
        const member = byContact.get(p.contact_id)
        return {
          displayName: p.contact.display_name,
          telegramId: member ? String(member.telegram_id) : null,
          username: member?.username ?? null,
          amount: p.amount,
          status: p.status as BoardParticipant['status'],
          isHost: p.contact.linked_user_id === bill.bill.creator_id,
        }
      })
      return {
        split,
        rendered: {
          text: renderPaymentBoard(
            { title: bill.bill.title, total: bill.bill.total, hostName, participants },
            tr
          ),
          keyboard: paymentBoardKeyboard(ctx, split.id),
        },
      }
    }
  }

  const roster: RosterMember[] = members.map((m) => ({
    telegramId: String(m.telegram_id),
    displayName: m.display_name,
    username: m.username,
    isRegistered: m.user_id !== null,
    isHost: m.user_id === creator.id,
  }))

  return {
    split,
    rendered: {
      text: renderSplitCard(
        {
          title,
          hostName,
          members: roster,
          hasReceipt: split.receipt_attachment_id !== null,
          status: split.status,
        },
        tr
      ),
      keyboard: splitCardKeyboard(ctx, split, {
        hasUnregistered: roster.some((m) => !m.isRegistered),
      }),
    },
  }
}

// ─── Throttled edits ─────────────────────────────────────────────────────────
// Telegram allows roughly 20 messages a minute to a group and counts edits
// against it. Ten people tapping Join in five seconds must therefore become two
// edits, not ten. Every render reads fresh state, so collapsing a burst loses
// nothing: the edit that does fire shows what the last one would have.

interface BoardTimer {
  lastEditAt: number | null
  pendingAt: number | null
  timer: ReturnType<typeof setTimeout> | null
  /** Grows on 429 so a rate-limited chat backs off instead of hammering. */
  intervalMs: number | undefined
}

const timers = new Map<string, BoardTimer>()

function timerFor(splitId: string, seed: Date | null): BoardTimer {
  let entry = timers.get(splitId)
  if (!entry) {
    // Seeded from the persisted board_edited_at so a restart cannot burst.
    entry = {
      lastEditAt: seed ? seed.getTime() : null,
      pendingAt: null,
      timer: null,
      intervalMs: undefined,
    }
    timers.set(splitId, entry)
  }
  return entry
}

/** Redraw a split's message, coalescing bursts. Never throws. */
export async function refreshGroupBoard(bot: Bot<MyContext>, splitId: string): Promise<void> {
  const details = await getSplitDetails(splitId)
  if (!details || details.split.board_message_id === null) return

  const entry = timerFor(splitId, details.split.board_edited_at)
  const now = Date.now()
  const decision = decideBoardEdit(entry.lastEditAt, entry.pendingAt, now, entry.intervalMs)

  if (decision.action === 'skip') return

  if (decision.action === 'schedule') {
    entry.pendingAt = now + decision.inMs
    entry.timer = setTimeout(() => {
      entry.pendingAt = null
      entry.timer = null
      void editNow(bot, splitId)
    }, decision.inMs)
    // Never hold the process open for a cosmetic edit.
    ;(entry.timer as { unref?: () => void }).unref?.()
    return
  }

  await editNow(bot, splitId)
}

async function editNow(bot: Bot<MyContext>, splitId: string): Promise<void> {
  const built = await renderBoard(bot, splitId)
  if (!built || built.split.board_message_id === null) return
  const { split, rendered } = built

  try {
    await bot.api.editMessageText(
      Number(split.chat_id),
      Number(split.board_message_id),
      rendered.text,
      { parse_mode: 'HTML', reply_markup: rendered.keyboard }
    )
    const at = new Date()
    timerFor(splitId, null).lastEditAt = at.getTime()
    await markBoardEdited(splitId, at)
  } catch (err) {
    await handleEditFailure(splitId, split, err)
  }
}

async function handleEditFailure(
  splitId: string,
  split: GroupSplit,
  err: unknown
): Promise<void> {
  // "message is not modified" is Telegram telling us the debounce already did
  // its job. GrammyError carries it on `description`; check both, since the
  // formatted `message` is not part of grammY's contract.
  const description = (err as { description?: unknown })?.description
  const haystack = `${typeof description === 'string' ? description : ''} ${
    err instanceof Error ? err.message : ''
  }`
  if (haystack.includes('message is not modified')) return

  const code = classifySendError(err)
  if (code === 'chat_not_found' || code === 'blocked') {
    // Kicked, or the group is gone. Retire whatever is open so the chat's
    // open-split slot is not held by a card nobody can see.
    log.warn({ splitId, code }, 'group board unreachable — cancelling open splits')
    await cancelSplitsForChat(split.chat_id).catch(() => undefined)
    return
  }
  if (code === 'rate_limited') {
    const entry = timerFor(splitId, null)
    entry.intervalMs = Math.min((entry.intervalMs ?? 3_000) * 2, 60_000)
    log.warn({ splitId, intervalMs: entry.intervalMs }, 'group board rate limited — backing off')
    return
  }
  log.warn({ err, splitId, code }, 'group board edit failed')
}

/**
 * Redraw the board belonging to a bill, if the bill came from a group.
 *
 * Called from the three notification.service functions every payment
 * transition already funnels through, so the bot handlers and the Mini App API
 * stay in sync without either knowing groups exist. One indexed lookup, and it
 * returns immediately for the overwhelming majority of bills, which have no
 * group.
 */
export async function refreshBoardForBill(bot: Bot<MyContext>, billId: string): Promise<void> {
  const split = await findSplitByBillId(billId)
  if (!split) return
  await refreshGroupBoard(bot, split.id)
}

/** Drop a split's in-memory timer state (used when a split reaches a terminal state). */
export function forgetBoardTimer(splitId: string): void {
  const entry = timers.get(splitId)
  if (entry?.timer) clearTimeout(entry.timer)
  timers.delete(splitId)
}

/**
 * Redraw the board for whichever bill a participant belongs to.
 *
 * Called at the TOP of the payment notification functions, before their
 * "can we DM this person" guards: a participant who never registered still
 * changes the board, and their undeliverable DM must not suppress it.
 */
export async function refreshBoardForParticipant(
  bot: Bot<MyContext>,
  participantId: string
): Promise<void> {
  const participant = await getParticipantById(participantId)
  if (!participant) return
  await refreshBoardForBill(bot, participant.bill_id)
}
