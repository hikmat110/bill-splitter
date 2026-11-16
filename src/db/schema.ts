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
  index,
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
  // Last time this user hit the API or the bot, bumped at most once per
  // LAST_SEEN_THROTTLE_MS (utils/last-seen). NULL = not seen since the column
  // shipped. Feeds the admin tab's active-user counts.
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
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
    // 16 digits (validated upstream via parseCardNumber), stored encrypted as
    // `v1.<iv>.<tag>.<ct>` (AES-256-GCM, utils/card-crypto). card.service is
    // the sole encrypt/decrypt boundary — never select or write this column
    // directly.
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
    // backfillLinkedUserByTelegramId runs on every registration and filters on
    // this column; without an index that is a full scan of every contact row,
    // and group joins make the path hot.
    index('contacts_linked_telegram_idx')
      .on(t.linked_telegram_id)
      .where(sql`${t.linked_telegram_id} IS NOT NULL`),
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

// ─── feedback ─────────────────────────────────────────────────────────────────

// In-app feedback / bug reports submitted from the Mini App. Context columns
// are client-supplied (capped by Zod) so an admin can reproduce: which screen
// the user was on, the webapp build, and the Telegram client.
export const feedback = pgTable('feedback', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  category: text('category').notNull(), // 'bug' | 'suggestion' | 'other'
  message: text('message').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'in_progress' | 'resolved'
  screen: text('screen').notNull(),
  build_id: text('build_id').notNull(),
  platform: text('platform').notNull(),
  tg_version: text('tg_version').notNull(),
  language: text('language').notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const feedbackRelations = relations(feedback, ({ one, many }) => ({
  user: one(users, {
    fields: [feedback.user_id],
    references: [users.id],
  }),
  attachments: many(feedbackAttachments),
}))

// ─── feedback_attachments ─────────────────────────────────────────────────────

export const feedbackAttachments = pgTable(
  'feedback_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    feedback_id: uuid('feedback_id')
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    // Opaque attachment id (file on disk, see storage.service) + its mime.
    // Unique so GET /api/files/:id can reverse-lookup the owning feedback.
    attachment_id: text('attachment_id').notNull(),
    mime: text('mime').notNull(),
    // The screenshot the widget captured automatically (at most one per
    // feedback), as opposed to images the user attached from the gallery.
    is_auto_capture: boolean('is_auto_capture').default(false).notNull(),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('feedback_attachments_attachment_unique').on(t.attachment_id)]
)

export const feedbackAttachmentsRelations = relations(
  feedbackAttachments,
  ({ one }) => ({
    feedback: one(feedback, {
      fields: [feedbackAttachments.feedback_id],
      references: [feedback.id],
    }),
  })
)

// ─── scan_events ─────────────────────────────────────────────────────────────

// One row per receipt-scan attempt, inserted BEFORE the Gemini call so that
// concurrent requests are counted. Backs the per-user sliding window and the
// global daily cap in scan-quota.service. `status` is 'pending' while the call
// is in flight, then 'ok' | 'parse' (Google answered → its RPD was consumed →
// counts) or 'upstream' (network / timeout / non-2xx / not configured → no RPD
// consumed → excluded from counts). Rows are never deleted: they double as
// usage analytics (see deploy/README.md "Quota").
export const scanEvents = pgTable(
  'scan_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'), // 'pending' | 'ok' | 'parse' | 'upstream'
    model: text('model').notNull(),
    duration_ms: integer('duration_ms'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('scan_events_user_created_idx').on(t.user_id, t.created_at),
    index('scan_events_created_idx').on(t.created_at),
  ]
)

export const scanEventsRelations = relations(scanEvents, ({ one }) => ({
  user: one(users, {
    fields: [scanEvents.user_id],
    references: [users.id],
  }),
}))

// ─── support_messages ────────────────────────────────────────────────────────

// A two-way support thread between one user and the admins. `user_id` is always
// the non-admin side, in both directions; a thread is every row for that user
// ordered by created_at. Inbound rows are written by the bot's text/photo
// fallthrough (a message no wizard was expecting), outbound ones by the admin
// tab. A Telegram message carries at most one photo, so the attachment lives
// inline rather than in a child table.
export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // 'in' (user → admins) | 'out' (admin → user)
    // Body of the message; '' when a photo arrived with no caption.
    text: text('text').notNull(),
    // Opaque attachment id (file on disk, see storage.service) + its mime.
    // Unique so GET /api/files/:id can reverse-lookup the owning message.
    attachment_id: text('attachment_id'),
    attachment_mime: text('attachment_mime'),
    // Which admin sent an 'out' row; null on 'in'. Kept as set-null so removing
    // an admin's account never deletes the conversation.
    admin_user_id: uuid('admin_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Telegram message id of the delivered/received message, for later edits.
    tg_message_id: bigint('tg_message_id', { mode: 'bigint' }),
    // Set once an admin has opened the thread ('in' rows only) — drives the
    // unread badge. 'out' rows are read by definition and stay null.
    read_at: timestamp('read_at', { withTimezone: true }),
    // A SendFailureCode (utils/telegram-errors) when Telegram refused an 'out'
    // message; null means delivered. Failed sends are still recorded so the
    // thread shows an undelivered bubble instead of losing the message.
    failure_code: text('failure_code'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('support_messages_user_created_idx').on(t.user_id, t.created_at),
    uniqueIndex('support_messages_attachment_unique')
      .on(t.attachment_id)
      .where(sql`${t.attachment_id} IS NOT NULL`),
    // Partial: only unread inbound rows are ever counted, and they are a tiny
    // slice of the table.
    index('support_messages_unread_idx')
      .on(t.user_id)
      .where(sql`${t.read_at} IS NULL`),
  ]
)

export const supportMessagesRelations = relations(supportMessages, ({ one }) => ({
  user: one(users, {
    fields: [supportMessages.user_id],
    references: [users.id],
    relationName: 'supportUser',
  }),
  admin: one(users, {
    fields: [supportMessages.admin_user_id],
    references: [users.id],
    relationName: 'supportAdmin',
  }),
}))

// ─── group_splits ─────────────────────────────────────────────────────────────
// A split started in a Telegram group with /split. It exists BEFORE a bill does:
// people tap Join on the card, and only once the creator opens the Mini App is
// an actual bill built from the collected roster.
//
// The group is a staging area, never the system of record — once a bill exists
// it lives in the creator's private history and stands on its own, so losing
// the group (bot kicked, chat deleted) never costs anyone money.

export const groupSplits = pgTable(
  'group_splits',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Telegram chat id of the group (negative). Deliberately not a FK: there is
    // no groups table, because the only fact worth storing about a group is
    // "is the bot still in it", which my_chat_member and a 403 answer for free.
    chat_id: bigint('chat_id', { mode: 'bigint' }).notNull(),
    creator_id: uuid('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    // The card the bot posted, edited in place as people join and later pay.
    board_message_id: bigint('board_message_id', { mode: 'bigint' }),
    // Forum topic the card lives in, so a re-post triggered outside a live
    // update (a payment hook) lands in the right topic instead of General.
    board_thread_id: integer('board_thread_id'),
    // collecting → building → sent, or cancelled / expired.
    status: text('status').notNull().default('collecting'),
    bill_id: uuid('bill_id').references(() => bills.id, { onDelete: 'set null' }),
    // Receipt photo replied to the card before the Mini App was opened; the app
    // scans it through the existing POST /api/receipts/scan.
    receipt_attachment_id: text('receipt_attachment_id'),
    receipt_mime: text('receipt_mime'),
    // Last successful board edit — the durable half of the flood guard, so a
    // restart cannot burst edits past Telegram's per-group ceiling.
    board_edited_at: timestamp('board_edited_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('group_splits_chat_status_idx').on(t.chat_id, t.status),
    // "One open split per group" as a database invariant rather than a race: a
    // second /split gets a clean unique violation instead of two rival cards.
    uniqueIndex('group_splits_one_open_per_chat')
      .on(t.chat_id)
      .where(sql`${t.status} in ('collecting','building')`),
    // Bill → board in one indexed lookup. The payment hooks run on every
    // payment event, including the overwhelming majority that have no group.
    uniqueIndex('group_splits_bill_unique')
      .on(t.bill_id)
      .where(sql`${t.bill_id} is not null`),
  ]
)

export const groupSplitsRelations = relations(groupSplits, ({ one, many }) => ({
  creator: one(users, {
    fields: [groupSplits.creator_id],
    references: [users.id],
  }),
  bill: one(bills, {
    fields: [groupSplits.bill_id],
    references: [bills.id],
  }),
  members: many(groupSplitMembers),
}))

// ─── group_split_members ──────────────────────────────────────────────────────
// Who tapped Join. This is the roster: a bot cannot enumerate a Telegram group,
// so opt-in taps are the only reliable membership source there is.

export const groupSplitMembers = pgTable(
  'group_split_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    split_id: uuid('split_id')
      .notNull()
      .references(() => groupSplits.id, { onDelete: 'cascade' }),
    // Always known: a Join is a callback query, which always carries `from`.
    telegram_id: bigint('telegram_id', { mode: 'bigint' }).notNull(),
    // NULL = joined before registering. Filled by the registration backfill in
    // user.service, so linking happens for anyone who starts the bot, from
    // anywhere — the deep link is only a shortcut, never load-bearing.
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    // The creator's contact row for this person, created on join.
    contact_id: uuid('contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    // Name as Telegram reported it at join time, so redrawing the card needs
    // no joins and still reads correctly for people who never registered.
    display_name: text('display_name').notNull(),
    username: text('username'),
    joined_at: timestamp('joined_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Makes a repeated Join tap idempotent: the second one conflicts, costs a
    // single answerCallbackQuery, and never touches the board.
    unique('group_split_members_split_tg_unique').on(t.split_id, t.telegram_id),
    index('group_split_members_tg_idx').on(t.telegram_id),
  ]
)

export const groupSplitMembersRelations = relations(groupSplitMembers, ({ one }) => ({
  split: one(groupSplits, {
    fields: [groupSplitMembers.split_id],
    references: [groupSplits.id],
  }),
  user: one(users, {
    fields: [groupSplitMembers.user_id],
    references: [users.id],
  }),
  contact: one(contacts, {
    fields: [groupSplitMembers.contact_id],
    references: [contacts.id],
  }),
}))

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Card = typeof cards.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type Bill = typeof bills.$inferSelect
export type BillItem = typeof billItems.$inferSelect
export type BillParticipant = typeof billParticipants.$inferSelect
export type Feedback = typeof feedback.$inferSelect
export type FeedbackAttachment = typeof feedbackAttachments.$inferSelect
export type ScanEvent = typeof scanEvents.$inferSelect
export type SupportMessage = typeof supportMessages.$inferSelect
export type GroupSplit = typeof groupSplits.$inferSelect
export type GroupSplitMember = typeof groupSplitMembers.$inferSelect
