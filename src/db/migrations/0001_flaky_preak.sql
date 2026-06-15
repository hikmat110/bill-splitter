ALTER TABLE "bill_items" ALTER COLUMN "price" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bill_participants" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "subtotal" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "service_fixed" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "tip" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "total" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "linked_telegram_id" bigint;