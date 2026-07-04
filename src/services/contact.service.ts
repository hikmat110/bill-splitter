import { and, eq, or, isNull, ne, exists } from 'drizzle-orm'
import { db } from '../db/client'
import { contacts, users, billParticipants, billItemShares, billItems, bills } from '../db/schema'
import type { Bill, Contact } from '../db/schema'
import { normalizePhone } from '../utils/phone'
import { findUserByUsername } from './user.service'

export async function listContacts(ownerId: string): Promise<Contact[]> {
  return db
    .select()
    .from(contacts)
    .where(and(
      eq(contacts.owner_id, ownerId),
      isNull(contacts.deleted_at),
      // Exclude self-contact (where the contact links back to the owner)
      or(
        isNull(contacts.linked_user_id),
        ne(contacts.linked_user_id, ownerId)
      )
    ))
    .orderBy(contacts.display_name)
}

export async function findContactById(contactId: string): Promise<Contact | null> {
  const result = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)
  return result[0] ?? null
}

export async function addContact(
  ownerId: string,
  displayName: string,
  phone?: string,
  linkedUserId?: string,
  linkedTelegramId?: bigint,
): Promise<Contact> {
  let normalizedPhone: string | null = null
  let resolvedLinkedUserId: string | null = linkedUserId ?? null

  if (phone) {
    normalizedPhone = normalizePhone(phone)
    if (!resolvedLinkedUserId) {
      const linked = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, normalizedPhone))
        .limit(1)
      resolvedLinkedUserId = linked[0]?.id ?? null
    }
  }

  const [contact] = await db
    .insert(contacts)
    .values({
      owner_id: ownerId,
      display_name: displayName,
      phone: normalizedPhone,
      linked_user_id: resolvedLinkedUserId,
      // Only keep a pending telegram link while the person is unregistered.
      linked_telegram_id: resolvedLinkedUserId ? null : (linkedTelegramId ?? null),
    })
    .returning()

  if (!contact) throw new Error('Failed to insert contact')
  return contact
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === '23505') return true
  return (
    err instanceof Error &&
    (err.message.includes('unique') || err.message.includes('duplicate'))
  )
}

/**
 * Insert a contact, retrying with a numeric suffix (`Name (2)`, `Name (3)`…) on
 * the `(owner_id, display_name)` unique constraint. Returns null if no free name
 * is found within the attempt budget.
 */
async function insertContactWithUniqueName(
  values: {
    owner_id: string
    linked_user_id?: string | null
    linked_telegram_id?: bigint | null
    phone?: string | null
  },
  baseName: string,
): Promise<Contact | null> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const name = attempt === 1 ? baseName : `${baseName} (${attempt})`
    try {
      const [contact] = await db
        .insert(contacts)
        .values({ ...values, display_name: name })
        .returning()
      if (contact) return contact
    } catch (err) {
      if (isUniqueViolation(err)) continue
      throw err
    }
  }
  return null
}

export interface BatchPerson {
  /** UUID of an already-registered user (preferred link). */
  userId?: string
  /** Telegram id, used for deferred linking when the person isn't registered. */
  telegramId?: bigint
  phone?: string | null
  displayName: string
}

export interface BatchResult {
  /** Newly added and linked to a registered user. */
  linked: string[]
  /** Newly added, name-only (not on the bot yet). */
  added: string[]
  /** Already in the owner's contacts — skipped. */
  skipped: string[]
}

/**
 * Add several contacts at once (multi-select picker / batch @username paste).
 * Dedupes against existing contacts and within the batch by linked user / telegram id,
 * and resolves name collisions with a numeric suffix.
 */
export async function addLinkedContactsBatch(
  ownerId: string,
  people: BatchPerson[],
): Promise<BatchResult> {
  // Soft-deleted contacts don't count as existing — deleting someone and then
  // re-adding them must work.
  const existing = await db
    .select({
      linked_user_id: contacts.linked_user_id,
      linked_telegram_id: contacts.linked_telegram_id,
    })
    .from(contacts)
    .where(and(eq(contacts.owner_id, ownerId), isNull(contacts.deleted_at)))

  const seenUserIds = new Set<string>(
    existing.map((c) => c.linked_user_id).filter((v): v is string => v != null)
  )
  const seenTgIds = new Set<bigint>(
    existing.map((c) => c.linked_telegram_id).filter((v): v is bigint => v != null)
  )

  const result: BatchResult = { linked: [], added: [], skipped: [] }

  for (const p of people) {
    if (p.userId && seenUserIds.has(p.userId)) {
      result.skipped.push(p.displayName)
      continue
    }
    if (p.telegramId != null && seenTgIds.has(p.telegramId)) {
      result.skipped.push(p.displayName)
      continue
    }

    let linkedUserId: string | null = p.userId ?? null
    let normalizedPhone: string | null = null
    if (p.phone) {
      normalizedPhone = normalizePhone(p.phone)
      if (!linkedUserId) {
        const [u] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phone, normalizedPhone))
          .limit(1)
        linkedUserId = u?.id ?? null
      }
    }
    const linkedTelegramId = linkedUserId ? null : (p.telegramId ?? null)

    const contact = await insertContactWithUniqueName(
      {
        owner_id: ownerId,
        linked_user_id: linkedUserId,
        linked_telegram_id: linkedTelegramId,
        phone: normalizedPhone,
      },
      p.displayName,
    )
    if (!contact) {
      result.skipped.push(p.displayName)
      continue
    }

    if (p.userId) seenUserIds.add(p.userId)
    if (p.telegramId != null) seenTgIds.add(p.telegramId)
    if (linkedUserId) result.linked.push(contact.display_name)
    else result.added.push(contact.display_name)
  }

  return result
}

export interface UsernameAddResult extends BatchResult {
  /** Handles with no matching registered user (without the leading `@`). */
  notFound: string[]
  /** Whether the owner's own username was among the handles (skipped). */
  selfSkipped: boolean
}

/**
 * Add contacts from a list of already-normalized Telegram handles. Resolves each
 * to a registered user (username lookup is local-only), skips the owner, and
 * batch-adds the rest. Shared by the bot's @username flow and the Mini App API.
 */
export async function addContactsByUsernames(
  ownerId: string,
  handles: string[],
): Promise<UsernameAddResult> {
  const people: BatchPerson[] = []
  const notFound: string[] = []
  let selfSkipped = false

  for (const handle of handles) {
    const found = await findUserByUsername(handle)
    if (!found) {
      notFound.push(handle)
      continue
    }
    if (found.id === ownerId) {
      selfSkipped = true
      continue
    }
    const displayName =
      [found.first_name, found.last_name].filter(Boolean).join(' ') || `@${handle}`
    people.push({ userId: found.id, phone: found.phone, displayName })
  }

  const batch =
    people.length > 0
      ? await addLinkedContactsBatch(ownerId, people)
      : { linked: [], added: [], skipped: [] }

  return { ...batch, notFound, selfSkipped }
}

export async function findOrCreateSelfContact(userId: string, firstName: string): Promise<Contact> {
  // Find existing self-contact (where both owner and linked user are the same person)
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.owner_id, userId), eq(contacts.linked_user_id, userId)))
    .limit(1)
  if (existing) return existing

  // Insert with suffix-on-collision via the shared helper
  const contact = await insertContactWithUniqueName(
    { owner_id: userId, linked_user_id: userId, phone: null },
    firstName,
  )
  if (contact) return contact

  // Final fallback: read whatever was created concurrently
  const [fallback] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.owner_id, userId), eq(contacts.linked_user_id, userId)))
    .limit(1)
  if (fallback) return fallback
  throw new Error('Could not create self-contact')
}

export interface ContactBillRef {
  id: string
  title: string
  status: string
  created_at: Date
}

/** All bills that reference a contact (as participant or item sharer), newest
 *  first — shown when a delete request needs the "used in these bills" list. */
export async function getBillsReferencingContact(contactId: string): Promise<ContactBillRef[]> {
  const viaParticipants = await db
    .select({ bill: bills })
    .from(billParticipants)
    .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
    .where(eq(billParticipants.contact_id, contactId))

  const viaShares = await db
    .select({ bill: bills })
    .from(billItemShares)
    .innerJoin(billItems, eq(billItemShares.bill_item_id, billItems.id))
    .innerJoin(bills, eq(billItems.bill_id, bills.id))
    .where(eq(billItemShares.contact_id, contactId))

  const byId = new Map<string, Bill>()
  for (const r of [...viaParticipants, ...viaShares]) byId.set(r.bill.id, r.bill)
  return [...byId.values()]
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .map((b) => ({ id: b.id, title: b.title, status: b.status, created_at: b.created_at }))
}

/**
 * The Telegram id behind a contact, for profile-photo lookups: the linked
 * registered user's id, else the deferred pre-registration link, else null.
 * Soft-deleted contacts intentionally resolve too — they still render inside
 * old bills.
 */
export async function getContactAvatarTelegramId(contactId: string): Promise<bigint | null> {
  const rows = await db
    .select({
      userTgId: users.telegram_id,
      contactTgId: contacts.linked_telegram_id,
    })
    .from(contacts)
    .leftJoin(users, eq(contacts.linked_user_id, users.id))
    .where(eq(contacts.id, contactId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return row.userTgId ?? row.contactTgId ?? null
}

export async function deleteContact(contactId: string): Promise<void> {
  await db.delete(contacts).where(eq(contacts.id, contactId))
}

/** Hide a bill-referenced contact from the owner's list; old bills keep
 *  rendering its name. Hard delete is reserved for unreferenced contacts. */
export async function softDeleteContact(contactId: string): Promise<void> {
  await db
    .update(contacts)
    .set({ deleted_at: new Date() })
    .where(eq(contacts.id, contactId))
}

export async function getContactCount(ownerId: string): Promise<number> {
  const result = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.owner_id, ownerId), isNull(contacts.deleted_at)))
  return result.length
}
