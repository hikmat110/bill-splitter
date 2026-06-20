ALTER TABLE "bill_participants" ADD COLUMN "payment_proof_attachment_id" text;--> statement-breakpoint
ALTER TABLE "bill_participants" ADD COLUMN "payment_proof_mime" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "receipt_attachment_id" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "receipt_mime" text;