import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { cards } from '../db/schema'
import type { Card } from '../db/schema'

export const MAX_CARDS_PER_USER = 10

/** Thrown by addCard when the user already has MAX_CARDS_PER_USER cards. */
export class CardLimitError extends Error {
  constructor() {
    super(`A user can keep at most ${MAX_CARDS_PER_USER} cards`)
    this.name = 'CardLimitError'
  }
}

/** All of a user's cards, default first, then oldest-added first. */
export async function listCards(userId: string): Promise<Card[]> {
  return db
    .select()
    .from(cards)
    .where(eq(cards.user_id, userId))
    .orderBy(desc(cards.is_default), asc(cards.created_at))
}

export async function findCardById(cardId: string): Promise<Card | null> {
  const rows = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1)
  return rows[0] ?? null
}

export async function getDefaultCard(userId: string): Promise<Card | null> {
  const rows = await db
    .select()
    .from(cards)
    .where(and(eq(cards.user_id, userId), eq(cards.is_default, true)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Add a card. The user's first card automatically becomes their default.
 * `number` must already be validated (16 digits — parseCardNumber).
 */
export async function addCard(
  userId: string,
  number: string,
  label?: string | null
): Promise<Card> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.user_id, userId))
    if (existing.length >= MAX_CARDS_PER_USER) throw new CardLimitError()

    const [card] = await tx
      .insert(cards)
      .values({
        user_id: userId,
        number,
        label: label ?? null,
        is_default: existing.length === 0,
      })
      .returning()
    if (!card) throw new Error('Failed to insert card')
    return card
  })
}

/** Make `cardId` the user's default. Ownership-checked; returns null if not theirs. */
export async function setDefaultCard(userId: string, cardId: string): Promise<Card | null> {
  return db.transaction(async (tx) => {
    const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).limit(1)
    if (!card || card.user_id !== userId) return null

    await tx.update(cards).set({ is_default: false }).where(eq(cards.user_id, userId))
    const [updated] = await tx
      .update(cards)
      .set({ is_default: true })
      .where(eq(cards.id, cardId))
      .returning()
    return updated ?? null
  })
}

/** Rename (or clear the custom name of) a card. Returns null if not the user's. */
export async function renameCard(
  userId: string,
  cardId: string,
  label: string | null
): Promise<Card | null> {
  const [updated] = await db
    .update(cards)
    .set({ label })
    .where(and(eq(cards.id, cardId), eq(cards.user_id, userId)))
    .returning()
  return updated ?? null
}

/**
 * Delete a card (bills referencing it keep working — bills.card_id SET NULLs).
 * If the default was removed, the newest remaining card is promoted.
 */
export async function deleteCard(userId: string, cardId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(cards)
      .where(and(eq(cards.id, cardId), eq(cards.user_id, userId)))
      .returning()
    if (!deleted) return false

    if (deleted.is_default) {
      const [next] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.user_id, userId))
        .orderBy(desc(cards.created_at))
        .limit(1)
      if (next) {
        await tx.update(cards).set({ is_default: true }).where(eq(cards.id, next.id))
      }
    }
    return true
  })
}
