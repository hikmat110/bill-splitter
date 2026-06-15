# Bill Splitter Telegram Bot

A Telegram bot for splitting bills among friends in Uzbekistan. Users register via phone share, maintain a contact list, create bills with itemized splits, notify participants who use the bot, and track payment status with creator confirmation.

## Tech Stack

- **Runtime**: Bun (latest stable)
- **Language**: TypeScript (strict)
- **Bot framework**: [grammY](https://grammy.dev) — TypeScript-first, idiomatic with Bun
- **Database**: PostgreSQL 16+
- **ORM**: Drizzle ORM + drizzle-kit
- **Validation**: Zod
- **Logging**: pino (pretty in dev)
- **Process manager**: PM2 in prod (Hikmat's existing Arcan setup)

## Project Structure

```
src/
├── bot/
│   ├── index.ts                # Bot entry, grammY composition
│   ├── middleware/
│   │   ├── auth.ts             # Requires registered user, attaches ctx.user
│   │   ├── session.ts          # Conversation state (in-memory for MVP)
│   │   └── logger.ts
│   ├── handlers/
│   │   ├── start.ts            # /start + phone registration
│   │   ├── menu.ts             # Main menu router
│   │   ├── contacts.ts         # Add/list/remove contacts
│   │   ├── new-bill.ts         # Bill creation wizard (multi-step)
│   │   ├── incoming.ts         # Bills sent TO this user
│   │   └── history.ts          # All past bills (created or received)
│   └── keyboards/              # Inline keyboard builders
├── db/
│   ├── schema.ts               # Drizzle schema (source of truth)
│   ├── client.ts               # Connection
│   └── migrations/             # drizzle-kit generated
├── services/                   # Business logic, no Telegram deps
│   ├── user.service.ts
│   ├── contact.service.ts
│   ├── bill.service.ts
│   └── notification.service.ts
├── utils/
│   ├── format.ts               # UZS currency, dates
│   ├── settlement.ts           # Pure split-calculation functions
│   └── callback.ts             # Encode/decode callback_data
├── i18n/
│   ├── index.ts                # t(ctx, key, vars)
│   ├── ru.ts                   # default
│   ├── uz.ts
│   └── en.ts
└── config.ts                   # Env vars via Zod
```

## Database Schema

### `users`
- `id` uuid pk
- `telegram_id` bigint unique not null
- `phone` text unique not null
- `first_name` text not null
- `last_name` text
- `username` text
- `language_code` text default `'ru'`
- `created_at` timestamptz default now

### `contacts`
Per-user address book. Holds a name and optional phone; if phone matches a registered user, `linked_user_id` is filled.
- `id` uuid pk
- `owner_id` uuid fk → users.id (on delete cascade)
- `linked_user_id` uuid fk → users.id (nullable)
- `display_name` text not null
- `phone` text (nullable)
- `created_at` timestamptz
- unique (`owner_id`, `display_name`)

### `bills`
- `id` uuid pk
- `creator_id` uuid fk → users.id
- `title` text not null
- `subtotal` numeric(14,2) not null — sum of items, in UZS
- `service_pct` numeric(5,2) default 0 — a percentage, not money
- `service_fixed` numeric(14,2) default 0
- `tip` numeric(14,2) default 0
- `total` numeric(14,2) not null
- `status` text not null default `'draft'` — one of `draft`, `sent`, `settled`, `cancelled`
- `created_at`, `updated_at` timestamptz

### `bill_items`
- `id` uuid pk
- `bill_id` uuid fk (cascade)
- `name` text not null
- `price` numeric(14,2) not null
- `quantity` int default 1
- `position` int — display order

### `bill_item_shares`
Composite-key table: who consumed each item.
- `bill_item_id` uuid fk (cascade)
- `contact_id` uuid fk → contacts.id
- PK: (`bill_item_id`, `contact_id`)

### `bill_participants`
Final per-person amounts and payment status.
- `id` uuid pk
- `bill_id` uuid fk (cascade)
- `contact_id` uuid fk → contacts.id
- `amount` numeric(14,2) not null
- `status` text not null default `'pending'` — `pending`, `marked_paid`, `confirmed`, `disputed`
- `marked_paid_at`, `confirmed_at`, `last_reminded_at` timestamptz (nullable)
- `notification_message_id` bigint — Telegram message id sent to participant, for editing later
- unique (`bill_id`, `contact_id`)

## Core Bot Flows

### 1. /start — Registration
1. Receive `/start`
2. If `ctx.from.id` already exists in `users` → show main menu
3. Otherwise reply with a `ReplyKeyboard` containing a single button with `request_contact: true`
4. On `message.contact`: validate `contact.user_id === ctx.from.id`, upsert user, set phone
5. Backfill: `UPDATE contacts SET linked_user_id = $newUserId WHERE phone = $phone AND linked_user_id IS NULL`
6. Remove reply keyboard, show main menu

### 2. Main Menu (inline keyboard)
- 🧾 New Bill
- 👥 Contacts
- 📥 Incoming (with unread badge from `bill_participants` where status=pending and contact links to user)
- 📜 History

### 3. New Bill Wizard
Multi-step conversation, state in session:
1. **Title** → free text
2. **Participants** → multi-select inline keyboard listing user's contacts + "➕ Add new" + "✅ Done"
3. **Items loop** — for each item:
   - Ask name
   - Ask price (numeric, validate)
   - Ask who shared this item (multi-select from selected participants; default = all)
   - Offer "➕ Add another item" or "Done with items"
4. **Service charge** — preset buttons `[0%, 10%, 12%, 15%, Custom]`
5. **Tip** — preset buttons `[None, 5k, 10k, 15k, Custom]`
6. **Review** — render full breakdown per person, with `[✏️ Edit]` `[📤 Send]` `[❌ Cancel]`
7. On Send: insert all rows in a transaction, set `status='sent'`, dispatch notifications

### 4. Sending a Bill
For each `bill_participants` row where the contact has `linked_user_id`:
- Send a message to that user with the bill summary + inline button `[✅ Mark as Paid]` (callback `bill:mark_paid:<participant_id>`)
- Save returned `message_id` to `notification_message_id`

For contacts without `linked_user_id`: nothing — they only exist in the creator's view.

### 5. Recipient Marks Paid
- Callback fires → set `status='marked_paid'`, `marked_paid_at=now()`
- Edit the participant's notification message to show "⏳ Awaiting confirmation"
- Send creator a new message: `"<name> marked their share (<amount>) as paid"` + `[✅ Confirm]` `[❌ Dispute]`

### 6. Creator Confirms or Disputes
- Confirm → `status='confirmed'`, `confirmed_at=now()`, edit both messages accordingly
- Dispute → ask creator for a reason → `status='disputed'`, notify participant with the reason

### 7. Reminders
- In the creator's bill detail view, each unpaid participant has `[🔔 Remind]`
- Sends a fresh reminder message to that participant; updates `last_reminded_at`
- Rate-limit: ignore button if `last_reminded_at` within 6 hours

### 8. History
- Tabs: "Created by me" / "Sent to me"
- List items show title, date, total, status summary (`3/4 paid`)
- Tap → full detail

## Settlement Algorithm

Pure functions in `utils/settlement.ts`. Given a bill spec, return `Map<contactId, amount>`.

```
For each item I:
  shareCount = I.shares.length
  perShare = to2(I.price / shareCount)   // equal sharers get equal shares
  for each contact C in I.shares:
    itemTotals[C] += perShare

subtotal = sum(I.price for items with ≥1 sharer)   // the TRUE subtotal
participantCount = number of distinct contacts across all items

for each participant P:
  base = itemTotals[P]
  serviceShare = to2(base * service_pct / 100) + to2(service_fixed / participantCount)
  tipShare = to2(tip / participantCount)
  total[P] = to2(base + serviceShare + tipShare)

// No reconciliation onto individuals. The bill total holds the true aggregate;
// per-person truncation means the small remainder lives in `total`.
bill.total = to2(subtotal + to2(subtotal * service_pct / 100) + service_fixed + tip)
```

Truncate every money result to 2 decimals via `to2` (a dust-guarded floor). Shares are kept equal and are never nudged; `total` carries the small remainder, so the invariant is `sum(splits) ≤ bill.total` with `bill.total − sum(splits)` sub-som (≥ 0).

## Conventions

- **Money**: stored as `numeric(14,2)` and handled as a JS `number` (real 2-decimal som, e.g. `33333.33`) via Drizzle `mode: 'number'`. Floats are permitted, but every computed money value must be normalized to 2 decimals with `to2` (`utils/settlement`) so float dust never surfaces. Ids (`telegram_id`, `notification_message_id`) remain `bigint`.
- **Callback data**: format `<entity>:<action>:<id>`, e.g. `bill:mark_paid:abc-123`. Hard 64-byte limit; for long ids use a short opaque ref stored in session.
- **Replies**: during a wizard, prefer `editMessageText` over sending new messages — keeps chats clean.
- **Errors**: never show stack traces to users. Catch at handler boundary, log with pino, reply with a generic localized error message.
- **i18n**: default `ru`, fall back gracefully if `language_code` unknown. All user-facing strings go through `t()`.
- **DB access**: only inside `services/`. Handlers call services; services call Drizzle. No raw SQL in handlers.
- **Transactions**: bill creation and bill cancellation must be atomic.
- **Logging**: include `telegram_id`, `chat_id`, `update_id` in every log line via child logger from middleware.

## Environment Variables (`.env`)

```
BOT_TOKEN=
DATABASE_URL=postgres://user:pass@localhost:5432/bill_splitter
LOG_LEVEL=info
NODE_ENV=development
ADMIN_TELEGRAM_IDS=  # optional, comma-separated, for /admin commands later
```

Validate at startup with Zod in `src/config.ts`. Fail fast if anything is missing.

## Development

```bash
bun install
docker compose up -d postgres   # local PG
bun run db:push                 # push schema
bun run dev                     # bot with --watch
bun run db:studio               # Drizzle Studio
bun run typecheck
```

## Out of Scope for MVP

Do NOT build these — they are explicitly deferred:
- Receipt photo OCR / image upload (users enter items manually)
- Share-tab / SMS / WhatsApp deeplinks
- Web dashboard
- Actual payment processing (only status tracking)
- Multi-currency (UZS only)
- Bot operating inside Telegram groups (private chats only)
- Real-time balance graphs across all bills (history is per-bill only)

## Open Questions / Decisions Already Made

- **Session storage**: in-memory for MVP. Move to Postgres-backed session when we add multiple bot replicas.
- **Phone format**: store as E.164 (`+998...`). Normalize on registration.
- **Time zone**: display in Asia/Tashkent regardless of system tz. Storage always UTC.
- **Contact deletion**: soft-delete if the contact has any past bills referencing them. Otherwise hard delete.
