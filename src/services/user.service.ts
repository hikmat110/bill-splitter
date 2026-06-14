import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { users, contacts } from '../db/schema'
import type { User } from '../db/schema'
import { normalizePhone } from '../utils/phone'
import { normalizeUsername } from '../utils/username'

export async function findByTelegramId(telegramId: bigint): Promise<User | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1)
  return result[0] ?? null
}

export async function upsertFromContact(
  contact: {
    phone_number: string
    first_name: string
    last_name?: string
  },
  from: {
    id: number
    username?: string
    language_code?: string
  }
): Promise<User> {
  const phone = normalizePhone(contact.phone_number)
  const telegramId = BigInt(from.id)
  // Default to Uzbek if Telegram doesn't provide a supported language
  const supportedLangs = ['uz', 'ru', 'en']
  const lang = from.language_code && supportedLangs.includes(from.language_code)
    ? from.language_code
    : 'uz'

  const [user] = await db
    .insert(users)
    .values({
      telegram_id: telegramId,
      phone,
      first_name: contact.first_name,
      last_name: contact.last_name ?? null,
      username: from.username ?? null,
      language_code: lang,
    })
    .onConflictDoUpdate({
      target: users.telegram_id,
      set: {
        phone,
        first_name: contact.first_name,
        last_name: contact.last_name ?? null,
        username: from.username ?? null,
      },
    })
    .returning()

  if (!user) throw new Error('Failed to upsert user')
  return user
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const clean = normalizeUsername(username)
  if (!clean) return null
  // Exact, case-insensitive match. Avoid ILIKE: Telegram usernames contain
  // underscores, which ILIKE would treat as a single-char wildcard.
  const result = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${clean}`)
    .limit(1)
  return result[0] ?? null
}

export async function findById(userId: string): Promise<User | null> {
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return result[0] ?? null
}

/** Resolve several Telegram ids to registered users in one query. */
export async function findByTelegramIds(ids: bigint[]): Promise<User[]> {
  if (ids.length === 0) return []
  return db.select().from(users).where(inArray(users.telegram_id, ids))
}

export async function backfillLinkedUser(phone: string, userId: string): Promise<void> {
  const normalized = normalizePhone(phone)
  await db
    .update(contacts)
    .set({ linked_user_id: userId })
    .where(eq(contacts.phone, normalized))
}

/**
 * Link contacts that were added by Telegram id before this person registered
 * (e.g. via the multi-select picker). Clears the now-resolved pending id.
 */
export async function backfillLinkedUserByTelegramId(
  telegramId: bigint,
  userId: string
): Promise<void> {
  await db
    .update(contacts)
    .set({ linked_user_id: userId, linked_telegram_id: null })
    .where(and(eq(contacts.linked_telegram_id, telegramId), isNull(contacts.linked_user_id)))
}

export async function updateCardNumber(userId: string, cardNumber: string | null): Promise<void> {
  await db.update(users).set({ card_number: cardNumber }).where(eq(users.id, userId))
}

export async function updateLanguage(userId: string, lang: 'uz' | 'ru' | 'en'): Promise<void> {
  await db.update(users).set({ language_code: lang }).where(eq(users.id, userId))
}
