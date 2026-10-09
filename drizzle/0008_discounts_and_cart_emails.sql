ALTER TYPE "public"."discount_type" ADD VALUE 'FREE_SHIPPING';--> statement-breakpoint
ALTER TABLE "discount_codes" DROP CONSTRAINT "discount_codes_value_pos";--> statement-breakpoint
ALTER TABLE "abandoned_carts" ADD COLUMN "emails_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "abandoned_carts" ADD COLUMN "payment_order_ref" text;--> statement-breakpoint
ALTER TABLE "abandoned_carts" ADD COLUMN "left_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "heading" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abandoned_carts_email_idx" ON "abandoned_carts" USING btree ("email");--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_value_pos" CHECK ("discount_codes"."value" > 0 OR "discount_codes"."type"::text = 'FREE_SHIPPING');