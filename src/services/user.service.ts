import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { users, contacts } from '../db/schema'
import type { User } from '../db/schema'

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

  const [user] = await db
    .insert(users)
    .values({
      telegram_id: telegramId,
      phone,
      first_name: contact.first_name,
      last_name: contact.last_name ?? null,
      username: from.username ?? null,
      language_code: from.language_code ?? 'ru',
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

export async function backfillLinkedUser(phone: string, userId: string): Promise<void> {
  const normalized = normalizePhone(phone)
  await db
    .update(contacts)
    .set({ linked_user_id: userId })
    .where(eq(contacts.phone, normalized))
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return `+${digits}`
}
