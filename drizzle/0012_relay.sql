ALTER TABLE "orders" ADD COLUMN "relay_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "relay_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "relay_first_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "relay_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "relay_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "relay_error" text;