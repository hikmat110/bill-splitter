import { and, eq, desc, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { groupSplits, groupSplitMembers, users } from '../db/schema'
import type { GroupSplit, GroupSplitMember, User } from '../db/schema'
import { OPEN_STATUSES, type SplitStatus } from '../utils/group-split'
import { isUniqueViolation } from '../utils/pg-errors'
import {
  addLinkedContactsBatch,
  findContactByLink,
  findOrCreateSelfContact,
} from './contact.service'

export interface SplitDetails {
  split: GroupSplit
  creator: User
  members: GroupSplitMember[]
}

/** The split currently holding this chat's single open-split slot, if any. */
export async function findOpenSplit(chatId: bigint): Promise<GroupSplit | null> {
  const [row] = await db
    .select()
    .from(groupSplits)
    .where(
      and(
        eq(groupSplits.chat_id, chatId),
        inArray(groupSplits.status, OPEN_STATUSES as unknown as string[])
      )
    )
    .limit(1)
  return row ?? null
}

export async function findSplitById(splitId: string): Promise<GroupSplit | null> {
  const [row] = await db.select().from(groupSplits).where(eq(groupSplits.id, splitId)).limit(1)
  return row ?? null
}

export async function findSplitByBillId(billId: string): Promise<GroupSplit | null> {
  const [row] = await db.select().from(groupSplits).where(eq(groupSplits.bill_id, billId)).limit(1)
  return row ?? null
}

export async function getSplitDetails(splitId: string): Promise<SplitDetails | null> {
  const split = await findSplitById(splitId)
  if (!split) return null

  const [creator] = await db.select().from(users).where(eq(users.id, split.creator_id)).limit(1)
  if (!creator) return null

  const members = await db
    .select()
    .from(groupSplitMembers)
    .where(eq(groupSplitMembers.split_id, splitId))
    .orderBy(groupSplitMembers.joined_at)

  return { split, creator, members }
}

async function setStatus(splitId: string, status: SplitStatus): Promise<void> {
  await db
    .update(groupSplits)
    .set({ status, updated_at: new Date() })
    .where(eq(groupSplits.id, splitId))
}

export const expireSplit = (splitId: string) => setStatus(splitId, 'expired')
export const cancelSplit = (splitId: string) => setStatus(splitId, 'cancelled')

/** Roster frozen: the creator has opened the Mini App to build the bill. */
export const claimSplit = (splitId: string) => setStatus(splitId, 'building')

/**
 * The bot was removed from a group. Retire whatever was open there — we cannot
 * edit the card any more, and a dangling `collecting` row would keep occupying
 * the chat's open-split slot if the bot is ever added back.
 *
 * Bills already created are untouched: they live in the creator's private
 * history and the participants keep their DMs. The group is a staging area,
 * never the system of record.
 */
export async function cancelSplitsForChat(chatId: bigint): Promise<void> {
  await db
    .update(groupSplits)
    .set({ status: 'cancelled', updated_at: new Date() })
    .where(
      and(
        eq(groupSplits.chat_id, chatId),
        inArray(groupSplits.status, OPEN_STATUSES as unknown as string[])
      )
    )
}

export interface CreateSplitInput {
  chatId: bigint
  creatorId: string
  title: string | null
  threadId: number | null
}

/**
 * Create the split. Returns null when the chat's open-split slot was taken
 * between the caller's check and this insert — the partial unique index
 * arbitrates the race, and the caller re-reads and points at the winner.
 */
export async function createSplit(input: CreateSplitInput): Promise<GroupSplit | null> {
  try {
    const [row] = await db
      .insert(groupSplits)
      .values({
        chat_id: input.chatId,
        creator_id: input.creatorId,
        title: input.title,
        board_thread_id: input.threadId,
      })
      .returning()
    return row ?? null
  } catch (err) {
    if (isUniqueViolation(err)) return null
    throw err
  }
}

export async function setBoardMessage(
  splitId: string,
  messageId: number,
  threadId: number | null
): Promise<void> {
  await db
    .update(groupSplits)
    .set({
      board_message_id: BigInt(messageId),
      board_thread_id: threadId,
      board_edited_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(groupSplits.id, splitId))
}

export async function markBoardEdited(splitId: string, at: Date): Promise<void> {
  await db
    .update(groupSplits)
    .set({ board_edited_at: at })
    .where(eq(groupSplits.id, splitId))
}

export async function attachReceipt(
  splitId: string,
  attachmentId: string,
  mime: string
): Promise<void> {
  await db
    .update(groupSplits)
    .set({ receipt_attachment_id: attachmentId, receipt_mime: mime, updated_at: new Date() })
    .where(eq(groupSplits.id, splitId))
}

export async function attachBill(splitId: string, billId: string): Promise<void> {
  await db
    .update(groupSplits)
    .set({ bill_id: billId, status: 'sent', updated_at: new Date() })
    .where(eq(groupSplits.id, splitId))
}

export interface JoinPerson {
  telegramId: bigint
  displayName: string
  username: string | null
  /** Set when the person is already registered. */
  userId: string | null
}

/**
 * Record a Join and mirror the person into the creator's address book.
 *
 * `joined: false` means the unique (split_id, telegram_id) constraint rejected
 * a repeat tap. That is the whole idempotency story: a double-tapper costs one
 * answerCallbackQuery and never touches the board.
 */
export async function joinSplit(
  split: GroupSplit,
  person: JoinPerson
): Promise<{ joined: boolean }> {
  const inserted = await db
    .insert(groupSplitMembers)
    .values({
      split_id: split.id,
      telegram_id: person.telegramId,
      user_id: person.userId,
      display_name: person.displayName,
      username: person.username,
    })
    .onConflictDoNothing({
      target: [groupSplitMembers.split_id, groupSplitMembers.telegram_id],
    })
    .returning()

  if (inserted.length === 0) return { joined: false }

  // Harvest the contact. addLinkedContactsBatch already dedupes by linked user
  // / telegram id and resolves name collisions to "Aziz (2)", so a person the
  // creator already knows is silently reused rather than duplicated.
  const contactId = await linkContactForJoiner(split.creator_id, person)
  if (contactId) {
    await db
      .update(groupSplitMembers)
      .set({ contact_id: contactId })
      .where(eq(groupSplitMembers.id, inserted[0]!.id))
  }

  await db
    .update(groupSplits)
    .set({ updated_at: new Date() })
    .where(eq(groupSplits.id, split.id))

  return { joined: true }
}

async function linkContactForJoiner(
  ownerId: string,
  person: JoinPerson
): Promise<string | null> {
  // The host joins their own split. They must map to the self-contact, not to a
  // contact of themselves in their own address book — the creator never appears
  // in the "owes" list (the self-participant invariant).
  if (person.userId && person.userId === ownerId) {
    const self = await findOrCreateSelfContact(ownerId, person.displayName)
    return self.id
  }

  await addLinkedContactsBatch(ownerId, [
    person.userId
      ? { userId: person.userId, displayName: person.displayName }
      : { telegramId: person.telegramId, displayName: person.displayName },
  ])
  const contact = await findContactByLink(
    ownerId,
    person.userId ? { userId: person.userId } : { telegramId: person.telegramId }
  )
  return contact?.id ?? null
}

export async function leaveSplit(
  splitId: string,
  telegramId: bigint
): Promise<{ left: boolean }> {
  const removed = await db
    .delete(groupSplitMembers)
    .where(
      and(
        eq(groupSplitMembers.split_id, splitId),
        eq(groupSplitMembers.telegram_id, telegramId)
      )
    )
    .returning()

  if (removed.length > 0) {
    await db
      .update(groupSplits)
      .set({ updated_at: new Date() })
      .where(eq(groupSplits.id, splitId))
  }
  // The contact stays in the creator's address book: they met this person, and
  // un-adding them would surprise the creator more than it would help.
  return { left: removed.length > 0 }
}

/** Splits this person joined but has not yet been linked to, for post-registration follow-up. */
export async function listPendingSplitsForTelegramId(
  telegramId: bigint
): Promise<GroupSplit[]> {
  const rows = await db
    .select({ split: groupSplits })
    .from(groupSplitMembers)
    .innerJoin(groupSplits, eq(groupSplitMembers.split_id, groupSplits.id))
    .where(
      and(
        eq(groupSplitMembers.telegram_id, telegramId),
        isNull(groupSplitMembers.contact_id)
      )
    )
    .orderBy(desc(groupSplits.created_at))
  return rows.map((r) => r.split)
}
