import {
  pgTable,
  uuid,
  bigint,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  unique,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// ─── users ───────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  telegram_id: bigint('telegram_id', { mode: 'bigint' }).unique().notNull(),
  phone: text('phone').unique().notNull(),
  first_name: text('first_name').notNull(),
  last_name: text('last_name'),
  username: text('username'),
  language_code: text('language_code').default('uz').notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  ownedContacts: many(contacts, { relationName: 'owner' }),
  linkedContacts: many(contacts, { relationName: 'linked' }),
  bills: many(bills),
  cards: many(cards),
}))

// ─── cards ───────────────────────────────────────────────────────────────────

// Payment cards a user receives transfers on. One is the default, attached to
// new bills unless the creator picks another (or none).
export const cards = pgTable(
  'cards',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 16 digits, validated upstream (parseCardNumber).
    number: text('number').notNull(),
    // Optional custom name; display falls back to "<network> ••<last4>".
    label: text('label'),
    is_default: boolean('is_default').default(false).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // At most one default card per user.
  (t) => [
    uniqueIndex('cards_user_default_unique')
      .on(t.user_id)
      .where(sql`${t.is_default}`),
  ]
)

export const cardsRelations = relations(cards, ({ one }) => ({
  user: one(users, {
    fields: [cards.user_id],
    references: [users.id],
  }),
}))

// ─── contacts ────────────────────────────────────────────────────────────────

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    owner_id: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    linked_user_id: uuid('linked_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Telegram id of a person added before they registered (e.g. via the
    // multi-select picker, which never returns a phone). Backfilled into
    // linked_user_id when that person starts the bot.
    linked_telegram_id: bigint('linked_telegram_id', { mode: 'bigint' }),
    display_name: text('display_name').notNull(),
    phone: text('phone'),
    // Soft-delete marker: a contact referenced by bills is never hard-deleted —
    // it is hidden from the owner's list but keeps rendering inside old bills.
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // Partial: only live contacts contend for a name, so a soft-deleted "Aziz"
  // doesn't block re-adding "Aziz".
  (t) => [
    uniqueIndex('contacts_owner_name_unique')
      .on(t.owner_id, t.display_name)
      .where(sql`${t.deleted_at} IS NULL`),
  ]
)

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  owner: one(users, {
    fields: [contacts.owner_id],
    references: [users.id],
    relationName: 'owner',
  }),
  linkedUser: one(users, {
    fields: [contacts.linked_user_id],
    references: [users.id],
    relationName: 'linked',
  }),
  itemShares: many(billItemShares),
  participations: many(billParticipants),
}))

// ─── bills ───────────────────────────────────────────────────────────────────

export const bills = pgTable('bills', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  creator_id: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  // Money is stored as numeric(14,2) — the real 2-decimal som value (e.g.
  // 33333.33), surfaced as a JS `number` via Drizzle's mode:'number'.
  subtotal: numeric('subtotal', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  service_pct: numeric('service_pct', { precision: 5, scale: 2 }).default('0').notNull(),
  service_fixed: numeric('service_fixed', { precision: 14, scale: 2, mode: 'number' })
    .default(0)
    .notNull(),
  tip: numeric('tip', { precision: 14, scale: 2, mode: 'number' }).default(0).notNull(),
  // Which participant fronted the tip. NULL = the creator paid it (default) —
  // existing rows keep today's behaviour. A non-creator here is credited the
  // full tip in settlement (their owed amount drops by it).
  tip_paid_by_contact_id: uuid('tip_paid_by_contact_id').references(() => contacts.id),
  // Card shown to participants for paying this bill. NULL = none attached
  // (also what a later card deletion leaves behind).
  card_id: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
  total: numeric('total', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  status: text('status').notNull().default('draft'),
  // Optional main receipt/cheque photo for the bill, shown to participants.
  // Opaque attachment id (file lives on disk, see storage.service) + its mime.
  receipt_attachment_id: text('receipt_attachment_id'),
  receipt_mime: text('receipt_mime'),
  // Creator-side archive: hidden from default lists, reversible (NULL = live).
  archived_at: timestamp('archived_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const billsRelations = relations(bills, ({ one, many }) => ({
  creator: one(users, {
    fields: [bills.creator_id],
    references: [users.id],
  }),
  card: one(cards, {
    fields: [bills.card_id],
    references: [cards.id],
  }),
  items: many(billItems),
  participants: many(billParticipants),
}))

// ─── bill_items ───────────────────────────────────────────────────────────────

export const billItems = pgTable('bill_items', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  bill_id: uuid('bill_id')
    .notNull()
    .references(() => bills.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  price: numeric('price', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  quantity: integer('quantity').default(1).notNull(),
  position: integer('position').notNull(),
})

export const billItemsRelations = relations(billItems, ({ one, many }) => ({
  bill: one(bills, {
    fields: [billItems.bill_id],
    references: [bills.id],
  }),
  shares: many(billItemShares),
}))

// ─── bill_item_shares ─────────────────────────────────────────────────────────

export const billItemShares = pgTable(
  'bill_item_shares',
  {
    bill_item_id: uuid('bill_item_id')
      .notNull()
      .references(() => billItems.id, { onDelete: 'cascade' }),
    contact_id: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    // How many of the item's units this person took. NULL = no explicit
    // assignment — the item (or the unassigned remainder) splits equally.
    units: integer('units'),
  },
  (t) => [primaryKey({ columns: [t.bill_item_id, t.contact_id] })]
)

export const billItemSharesRelations = relations(billItemShares, ({ one }) => ({
  billItem: one(billItems, {
    fields: [billItemShares.bill_item_id],
    references: [billItems.id],
  }),
  contact: one(contacts, {
    fields: [billItemShares.contact_id],
    references: [contacts.id],
  }),
}))

// ─── bill_participants ────────────────────────────────────────────────────────

export const billParticipants = pgTable(
  'bill_participants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    bill_id: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    contact_id: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    status: text('status').notNull().default('pending'),
    marked_paid_at: timestamp('marked_paid_at', { withTimezone: true }),
    confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
    last_reminded_at: timestamp('last_reminded_at', { withTimezone: true }),
    notification_message_id: bigint('notification_message_id', {
      mode: 'bigint',
    }),
    // Optional proof-of-transfer photo the payer attaches when marking paid,
    // shown to the creator. Opaque attachment id (file on disk) + its mime.
    payment_proof_attachment_id: text('payment_proof_attachment_id'),
    payment_proof_mime: text('payment_proof_mime'),
  },
  (t) => [
    unique('bill_participants_bill_contact_unique').on(t.bill_id, t.contact_id),
  ]
)

export const billParticipantsRelations = relations(
  billParticipants,
  ({ one }) => ({
    bill: one(bills, {
      fields: [billParticipants.bill_id],
      references: [bills.id],
    }),
    contact: one(contacts, {
      fields: [billParticipants.contact_id],
      references: [contacts.id],
    }),
  })
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Card = typeof cards.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type Bill = typeof bills.$inferSelect
export type BillItem = typeof billItems.$inferSelect
export type BillParticipant = typeof billParticipants.$inferSelect
