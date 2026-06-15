ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "tip_paid_by_contact_id" uuid;--> statement-breakpoint
-- NOTE: contacts.linked_telegram_id pre-dates this feature but was missing from the
-- 0000 snapshot, so drizzle folded it into this migration. IF NOT EXISTS keeps it safe
-- on databases already synced via `db:push`.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "linked_telegram_id" bigint;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tip_paid_by_contact_id_contacts_id_fk" FOREIGN KEY ("tip_paid_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;