CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"text" text NOT NULL,
	"attachment_id" text,
	"attachment_mime" text,
	"admin_user_id" uuid,
	"tg_message_id" bigint,
	"read_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_messages_user_created_idx" ON "support_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_attachment_unique" ON "support_messages" USING btree ("attachment_id") WHERE "support_messages"."attachment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_messages_unread_idx" ON "support_messages" USING btree ("user_id") WHERE "support_messages"."read_at" IS NULL;