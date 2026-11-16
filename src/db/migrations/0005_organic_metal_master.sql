CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"number" text NOT NULL,
	"label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "card_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_user_default_unique" ON "cards" USING btree ("user_id") WHERE "cards"."is_default";--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "cards" ("user_id", "number", "is_default") SELECT "id", "card_number", true FROM "users" WHERE "card_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "card_number";