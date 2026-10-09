CREATE TABLE "popups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"eyebrow" text,
	"headline" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"button_label" text NOT NULL,
	"button_url" text,
	"discount_code_id" uuid,
	"sends_email" boolean DEFAULT true NOT NULL,
	"trigger" text DEFAULT 'DELAY' NOT NULL,
	"delay_seconds" integer DEFAULT 6 NOT NULL,
	"pages" text DEFAULT 'ALL' NOT NULL,
	"show_again_days" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popups_kind" CHECK ("popups"."kind" IN ('EMAIL', 'CODE', 'MESSAGE')),
	CONSTRAINT "popups_trigger" CHECK ("popups"."trigger" IN ('DELAY', 'EXIT', 'SCROLL')),
	CONSTRAINT "popups_pages" CHECK ("popups"."pages" IN ('ALL', 'HOME', 'PRODUCTS'))
);
--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "first_order_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "unsubscribe_token" text;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "welcome_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "popups" ADD CONSTRAINT "popups_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "popups_enabled_idx" ON "popups" USING btree ("is_enabled","position");--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_unsubscribe_token_unique" UNIQUE("unsubscribe_token");--> statement-breakpoint
-- The first-order code the sign-up pop-up gives. Left alone if the store already has one by this name.
INSERT INTO "discount_codes" ("code", "type", "value", "per_customer_limit", "first_order_only", "note")
VALUES ('WELCOME10', 'PERCENTAGE', 10, 1, true, 'First order welcome offer, given by the sign-up pop-up')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- The first pop-up: an email sign-up for 10% off a first order, switched on.
INSERT INTO "popups" ("name", "kind", "is_enabled", "position", "eyebrow", "headline", "body", "button_label", "discount_code_id", "sends_email", "trigger", "delay_seconds", "pages", "show_again_days")
SELECT 'First order sign-up', 'EMAIL', true, 0, 'First order', 'Take 10% off',
       'Join the list and get a code for your first order. New designs and offers, no spam.',
       'Get my code', "id", true, 'DELAY', 6, 'ALL', 7
FROM "discount_codes" WHERE "code" = 'WELCOME10';
