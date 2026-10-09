ALTER TABLE "admin_users" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "stripe_livemode" boolean;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD COLUMN "card_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD COLUMN "card_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD COLUMN "transfer_ref" text;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD COLUMN "payout_ref" text;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD COLUMN "provider_error" text;--> statement-breakpoint
CREATE INDEX "partner_payouts_payout_ref_idx" ON "partner_payouts" USING btree ("payout_ref");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_stripe_account_id_unique" UNIQUE("stripe_account_id");