ALTER TABLE "contacts" DROP CONSTRAINT "contacts_owner_name_unique";--> statement-breakpoint
ALTER TABLE "bill_item_shares" ADD COLUMN "units" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_owner_name_unique" ON "contacts" USING btree ("owner_id","display_name") WHERE "contacts"."deleted_at" IS NULL;