import type { Bot } from 'grammy'
import type { MyContext } from '../../index'
import type { GroupSplit, User } from '../../../db/schema'
import { t } from '../../../i18n'
import { toast } from './reply'
import { startBotKeyboard } from '../../keyboards'
import {
  ReplyThrottle,
  NEED_ACCOUNT_WINDOW_MS,
  BOARD_COMMAND_WINDOW_MS,
  REMIND_WINDOW_MS,
} from '../../../utils/group-throttle'
import { decideSplitStart, canPressSplitAction } from '../../../utils/group-split'
import { renderRemindText, type BoardParticipant } from '../../../utils/board-render'
import { buildSplitPayload, startLink } from '../../../utils/deep-link'
import {
  findOpenSplit,
  findSplitById,
  getSplitDetails,
  createSplit,
  expireSplit,
  cancelSplit,
  setBoardMessage,
  joinSplit,
  leaveSplit,
} from '../../../services/group-split.service'
import { renderBoard, refreshGroupBoard, forgetBoardTimer } from '../../../services/group-board.service'
import { getBillWithDetails, markParticipantPaid } from '../../../services/bill.service'
import {
  notifyCreatorOfPaymentMark,
  sendReminder,
} from '../../../services/notification.service'

// Telling a stranger how to register is the ONE unsolicited-ish message the bot
// sends in a group, and it is always a direct answer to a command addressed to
// it. Beyond the window, silence.
const needAccount = new ReplyThrottle(NEED_ACCOUNT_WINDOW_MS)
const boardCommand = new ReplyThrottle(BOARD_COMMAND_WINDOW_MS)
const remindCommand = new ReplyThrottle(REMIND_WINDOW_MS)

function threadIdOf(ctx: MyContext): number | null {
  // Forum supergroups: a reply must carry the topic or it lands in General.
  return ctx.message?.message_thread_id ?? null
}

async function requireUser(ctx: MyContext): Promise<User | null> {
  const user = ctx.user as User | undefined
  if (user) return user
  if (needAccount.take(`${ctx.chat?.id}:${ctx.from?.id}`)) {
    await ctx
      .reply(t(ctx, 'group.need_account'), { reply_markup: startBotKeyboard(ctx) })
      .catch(() => undefined)
  }
  return null
}

/** Post (or re-post) the split's single message and remember where it landed. */
async function postBoard(ctx: MyContext, bot: Bot<MyContext>, splitId: string): Promise<void> {
  const built = await renderBoard(bot, splitId)
  if (!built) return
  const sent = await ctx.reply(built.rendered.text, {
    parse_mode: 'HTML',
    reply_markup: built.rendered.keyboard,
  })
  await setBoardMessage(splitId, sent.message_id, threadIdOf(ctx))
}

// ─── /split ───────────────────────────────────────────────────────────────────

export async function splitStartHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const user = await requireUser(ctx)
  if (!user) return

  const chatId = BigInt(ctx.chat!.id)
  const title = ctx.match?.toString().trim() || null

  const existing = await findOpenSplit(chatId)
  const decision = decideSplitStart(existing, user.id, new Date())

  if (decision.action === 'reuse') {
    await ctx
      .reply(t(ctx, 'group.split_exists', { bot: ctx.me.username }))
      .catch(() => undefined)
    return
  }
  if (decision.action === 'expire_and_create') {
    await expireSplit(decision.splitId)
    forgetBoardTimer(decision.splitId)
  }

  const split = await createSplit({
    chatId,
    creatorId: user.id,
    title,
    threadId: threadIdOf(ctx),
  })
  if (!split) {
    // Lost the race for this chat's open-split slot; the winner's card stands.
    await ctx
      .reply(t(ctx, 'group.split_exists', { bot: ctx.me.username }))
      .catch(() => undefined)
    return
  }

  await joinSplit(split, {
    telegramId: BigInt(ctx.from!.id),
    displayName: user.first_name,
    username: ctx.from!.username ?? null,
    userId: user.id,
  })

  await postBoard(ctx, bot, split.id)
}

// ─── /board ───────────────────────────────────────────────────────────────────

export async function boardCommandHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  // Over the limit the right answer in a group is nothing at all.
  if (!boardCommand.take(String(ctx.chat!.id))) return

  const split = await findOpenSplit(BigInt(ctx.chat!.id))
  if (!split) {
    await ctx
      .reply(t(ctx, 'group.no_split', { bot: ctx.me.username }))
      .catch(() => undefined)
    return
  }
  await postBoard(ctx, bot, split.id)
}

// ─── /cancel ──────────────────────────────────────────────────────────────────

export async function splitCancelCommandHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const user = ctx.user as User | undefined
  if (!user) return

  const split = await findOpenSplit(BigInt(ctx.chat!.id))
  if (!split || split.creator_id !== user.id) return

  await cancelSplit(split.id)
  forgetBoardTimer(split.id)
  await refreshGroupBoard(bot, split.id)
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

export async function groupCallbackHandler(
  ctx: MyContext,
  action: string,
  splitId: string,
  bot: Bot<MyContext>
): Promise<void> {
  const split = await findSplitById(splitId)
  if (!split) {
    await toast(ctx, 'group.toast.closed')
    return
  }

  const user = ctx.user as User | undefined
  const isCreator = user?.id === split.creator_id

  if (action === 'j') return joinPressed(ctx, bot, split, user)
  if (action === 'l') return leavePressed(ctx, bot, split, isCreator)
  if (action === 'x') return cancelPressed(ctx, bot, split, isCreator)
  if (action === 'p') return paidPressed(ctx, bot, split, user)
  if (action === 'r') return remindPressed(ctx, bot, split, isCreator)

  // Unknown action (an old keyboard, a hand-crafted payload): answer anyway,
  // otherwise the presser's client spins until Telegram times it out.
  await toast(ctx, 'group.toast.closed')
}

async function joinPressed(
  ctx: MyContext,
  bot: Bot<MyContext>,
  split: GroupSplit,
  user: User | undefined
): Promise<void> {
  const verdict = canPressSplitAction('join', split, user?.id === split.creator_id)
  if (!verdict.ok) return toast(ctx, `group.toast.${verdict.reason}` as 'group.toast.closed')

  const from = ctx.from!
  const { joined } = await joinSplit(split, {
    telegramId: BigInt(from.id),
    displayName: from.first_name,
    username: from.username ?? null,
    userId: user?.id ?? null,
  })

  if (!joined) {
    // Repeat tap: one toast, and the board is left alone.
    await toast(ctx, 'group.toast.already_joined')
    return
  }

  if (!user) {
    // Telegram lets a callback answer carry a t.me link, so an unregistered
    // joiner is sent straight to the private chat — no extra group message,
    // nothing to copy and paste.
    await toast(ctx, 'group.toast.activate', {
      url: startLink(ctx.me.username, buildSplitPayload(split.id)),
    })
  } else {
    await toast(ctx, 'group.toast.joined')
  }

  await refreshGroupBoard(bot, split.id)
}

async function leavePressed(
  ctx: MyContext,
  bot: Bot<MyContext>,
  split: { id: string; status: string },
  isCreator: boolean
): Promise<void> {
  const verdict = canPressSplitAction('leave', split, isCreator)
  if (!verdict.ok) return toast(ctx, `group.toast.${verdict.reason}` as 'group.toast.closed')

  const { left } = await leaveSplit(split.id, BigInt(ctx.from!.id))
  await toast(ctx, left ? 'group.toast.left' : 'group.toast.not_joined')
  if (left) await refreshGroupBoard(bot, split.id)
}

async function cancelPressed(
  ctx: MyContext,
  bot: Bot<MyContext>,
  split: { id: string; status: string },
  isCreator: boolean
): Promise<void> {
  const verdict = canPressSplitAction('cancel', split, isCreator)
  if (!verdict.ok) {
    // Authorization failures are toasts, never group messages — this is what
    // keeps the bot incapable of being used to spam a chat.
    await toast(ctx, `group.toast.${verdict.reason}` as 'group.toast.closed', { alert: true })
    return
  }

  await cancelSplit(split.id)
  await toast(ctx, 'group.toast.cancelled')
  // Drop any debounced edit first: otherwise refreshGroupBoard would see one
  // pending, skip, and the card would never show the cancellation.
  forgetBoardTimer(split.id)
  await refreshGroupBoard(bot, split.id)
}

async function paidPressed(
  ctx: MyContext,
  bot: Bot<MyContext>,
  split: { id: string; bill_id: string | null },
  user: User | undefined
): Promise<void> {
  if (!user || !split.bill_id) return toast(ctx, 'group.toast.not_participant')

  const details = await getBillWithDetails(split.bill_id)
  const mine = details?.participants.find((p) => p.contact.linked_user_id === user.id)
  if (!mine) return toast(ctx, 'group.toast.not_participant')
  if (mine.status !== 'pending') return toast(ctx, 'group.toast.already_paid')

  await markParticipantPaid(mine.id)
  await toast(ctx, 'group.toast.marked_paid')
  // notifyCreatorOfPaymentMark refreshes the board on its way out.
  await notifyCreatorOfPaymentMark(bot, mine.id)
}

async function remindPressed(
  ctx: MyContext,
  bot: Bot<MyContext>,
  split: { id: string; bill_id: string | null },
  isCreator: boolean
): Promise<void> {
  if (!isCreator) return toast(ctx, 'group.toast.not_creator', { alert: true })
  if (!split.bill_id) return toast(ctx, 'group.toast.closed')

  const details = await getSplitDetails(split.id)
  const bill = await getBillWithDetails(split.bill_id)
  if (!details || !bill) return toast(ctx, 'group.toast.closed')

  const unpaid = bill.participants.filter(
    (p) => p.status !== 'confirmed' && p.contact.linked_user_id !== bill.bill.creator_id
  )
  if (unpaid.length === 0) return toast(ctx, 'group.toast.nothing_to_remind')

  if (!remindCommand.take(split.id)) return toast(ctx, 'group.toast.remind_cooldown')

  // DM each of them (sendReminder keeps its own 6-hour per-participant cooldown)
  // and collect whoever was actually reminded for the single public nudge.
  const byContact = new Map(details.members.filter((m) => m.contact_id).map((m) => [m.contact_id!, m]))
  const reminded: BoardParticipant[] = []
  for (const p of unpaid) {
    const sent = await sendReminder(bot, p.id)
    if (!sent) continue
    const member = byContact.get(p.contact_id)
    reminded.push({
      displayName: p.contact.display_name,
      telegramId: member ? String(member.telegram_id) : null,
      username: member?.username ?? null,
      amount: p.amount,
      status: p.status as BoardParticipant['status'],
      isHost: false,
    })
  }

  if (reminded.length === 0) return toast(ctx, 'group.toast.remind_cooldown')

  await toast(ctx, 'group.toast.reminded')
  await ctx
    .reply(renderRemindText(reminded, (key, vars) => t(ctx, key, vars)), {
      parse_mode: 'HTML',
    })
    .catch(() => undefined)
}
