CREATE TABLE "admin_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text,
	"invited_by" text NOT NULL,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invites_admin_id_unique" UNIQUE("admin_id"),
	CONSTRAINT "admin_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_pos" CHECK ("expenses"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"destination" text,
	"receipt" jsonb NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"closed_by" text,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "partner_payouts_amount_pos" CHECK ("partner_payouts"."amount_cents" > 0),
	CONSTRAINT "partner_payouts_status" CHECK ("partner_payouts"."status" IN ('REQUESTED', 'SENT', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "payout_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_adjustments_nonzero" CHECK ("payout_adjustments"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "profit_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"share_bps" integer NOT NULL,
	"effective_on" date NOT NULL,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profit_shares_range" CHECK ("profit_shares"."share_bps" >= 0 AND "profit_shares"."share_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "recurring_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"every" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_costs_amount_pos" CHECK ("recurring_costs"."amount_cents" > 0),
	CONSTRAINT "recurring_costs_every" CHECK ("recurring_costs"."every" IN ('MONTH', 'YEAR'))
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "payout_handle" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "income_tax_bps" integer DEFAULT 2200 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "processing_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_shares" ADD CONSTRAINT "profit_shares_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_spent_on_idx" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX "partner_payouts_admin_idx" ON "partner_payouts" USING btree ("admin_id","requested_at");--> statement-breakpoint
CREATE INDEX "payout_adjustments_admin_idx" ON "payout_adjustments" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "profit_shares_admin_idx" ON "profit_shares" USING btree ("admin_id","effective_on");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cost_nonneg" CHECK ("orders"."cost_cents" IS NULL OR "orders"."cost_cents" >= 0);--> statement-breakpoint
-- The master account is Henry's.
UPDATE "admin_users" SET "name" = 'Henry Palacios' WHERE lower("email") = 'voidsznstore@gmail.com';--> statement-breakpoint
-- The two partners. The password can't be typed; each sets a real one from the emailed invitation.
-- Only where the store already has its owner: a fresh database stays empty, so first-time set-up still works.
INSERT INTO "admin_users" ("email", "password_hash", "name", "role")
SELECT v."email", '!invited', v."name", 'STAFF'::"admin_role"
FROM (VALUES ('israelgtx04@gmail.com', 'Israel'), ('adamnogueiraa@gmail.com', 'Adam')) AS v("email", "name")
WHERE EXISTS (SELECT 1 FROM "admin_users" WHERE "role" = 'OWNER')
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint
-- Waiting to be emailed. The site sends these itself once it is running.
INSERT INTO "admin_invites" ("admin_id", "invited_by")
SELECT "id", 'Henry Palacios' FROM "admin_users"
WHERE "email" IN ('israelgtx04@gmail.com', 'adamnogueiraa@gmail.com') AND "password_hash" = '!invited'
ON CONFLICT ("admin_id") DO NOTHING;--> statement-breakpoint
-- An even three-way split of the profit, from the start: the owner and the two partners.
INSERT INTO "profit_shares" ("admin_id", "share_bps", "effective_on", "set_by")
SELECT "id", 3333, DATE '2000-01-01', 'Set-up' FROM "admin_users"
WHERE "role" = 'OWNER' OR "email" IN ('israelgtx04@gmail.com', 'adamnogueiraa@gmail.com');
