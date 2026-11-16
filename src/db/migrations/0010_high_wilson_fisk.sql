CREATE TABLE "group_split_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_id" uuid NOT NULL,
	"telegram_id" bigint NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"display_name" text NOT NULL,
	"username" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_split_members_split_tg_unique" UNIQUE("split_id","telegram_id")
);
--> statement-breakpoint
CREATE TABLE "group_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" text,
	"board_message_id" bigint,
	"board_thread_id" integer,
	"status" text DEFAULT 'collecting' NOT NULL,
	"bill_id" uuid,
	"receipt_attachment_id" text,
	"receipt_mime" text,
	"board_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_split_members" ADD CONSTRAINT "group_split_members_split_id_group_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."group_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_split_members" ADD CONSTRAINT "group_split_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_split_members" ADD CONSTRAINT "group_split_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_splits" ADD CONSTRAINT "group_splits_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_splits" ADD CONSTRAINT "group_splits_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_split_members_tg_idx" ON "group_split_members" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "group_splits_chat_status_idx" ON "group_splits" USING btree ("chat_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "group_splits_one_open_per_chat" ON "group_splits" USING btree ("chat_id") WHERE "group_splits"."status" in ('collecting','building');--> statement-breakpoint
CREATE UNIQUE INDEX "group_splits_bill_unique" ON "group_splits" USING btree ("bill_id") WHERE "group_splits"."bill_id" is not null;--> statement-breakpoint
CREATE INDEX "contacts_linked_telegram_idx" ON "contacts" USING btree ("linked_telegram_id") WHERE "contacts"."linked_telegram_id" IS NOT NULL;