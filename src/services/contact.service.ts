import { and, eq, or, exists } from 'drizzle-orm'
import { db } from '../db/client'
import { contacts, users, billParticipants, billItemShares } from '../db/schema'
import type { Contact } from '../db/schema'
import { normalizePhone } from '../utils/phone'

export async function listContacts(ownerId: string): Promise<Contact[]> {
  return db
    .select()
    .from(contacts)
    .where(eq(contacts.owner_id, ownerId))
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
  phone?: string
): Promise<Contact> {
  let normalizedPhone: string | null = null
  let linkedUserId: string | null = null

  if (phone) {
    normalizedPhone = normalizePhone(phone)
    const linked = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, normalizedPhone))
      .limit(1)
    linkedUserId = linked[0]?.id ?? null
  }

  const [contact] = await db
    .insert(contacts)
    .values({
      owner_id: ownerId,
      display_name: displayName,
      phone: normalizedPhone,
      linked_user_id: linkedUserId,
    })
    .returning()

  if (!contact) throw new Error('Failed to insert contact')
  return contact
}

export async function isContactReferencedInBills(contactId: string): Promise<boolean> {
  const inParticipants = db
    .select({ id: billParticipants.id })
    .from(billParticipants)
    .where(eq(billParticipants.contact_id, contactId))
    .limit(1)

  const inShares = db
    .select({ contact_id: billItemShares.contact_id })
    .from(billItemShares)
    .where(eq(billItemShares.contact_id, contactId))
    .limit(1)

  const [participantHit] = await inParticipants
  if (participantHit) return true
  const [shareHit] = await inShares
  return !!shareHit
}

export async function deleteContact(contactId: string): Promise<void> {
  await db.delete(contacts).where(eq(contacts.id, contactId))
}

export async function getContactCount(ownerId: string): Promise<number> {
  const result = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.owner_id, ownerId))
  return result.length
}
