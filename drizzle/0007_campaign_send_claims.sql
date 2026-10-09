ALTER TABLE "campaign_sends" ADD COLUMN "batch_key" text;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD COLUMN "claimed_at" timestamp with time zone;