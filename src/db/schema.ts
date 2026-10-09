/**
 * VOIDSZN database schema.
 *
 * Conventions
 * - Money is stored as integer cents. Never floats, never decimals.
 * - Prices are always recalculated on the server from this data. The cart is never trusted.
 * - `costCents` fields are internal. Never select them in a public query.
 * - Nothing here tracks stock: every item is printed to order.
 * - Payment and fulfillment fields use generic names so either provider can be swapped.
 */
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

/** One line of a cart someone started to pay for. Prices are as they were at that moment. */
export type CartSnapshotItem = {
  slug: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl: string | null;
};

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const adminRole = pgEnum("admin_role", ["OWNER", "STAFF"]);

/**
 * PRODUCT_TYPE is what the item is (T-Shirts, Hoodies). INTEREST is what the
 * design is about (Anime, Gaming). A product has one type and any number of interests.
 */
export const categoryKind = pgEnum("category_kind", ["PRODUCT_TYPE", "INTEREST"]);

export const fulfillmentProvider = pgEnum("fulfillment_provider", ["MANUAL", "PRINTMOOD"]);

export const orderStatus = pgEnum("order_status", [
  "PENDING", // created, not yet paid
  "PAID", // payment confirmed by the processor
  "IN_PRODUCTION", // sent to the printer
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

export const paymentStatus = pgEnum("payment_status", [
  "UNPAID",
  "PAID",
  "FAILED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

export const fulfillmentStatus = pgEnum("fulfillment_status", [
  "UNSUBMITTED", // paid, waiting to be sent to the printer
  "SUBMITTED",
  "IN_PRODUCTION",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
]);

/** FREE_SHIPPING takes shipping off the order and nothing off the items. */
export const discountType = pgEnum("discount_type", ["PERCENTAGE", "FIXED", "FREE_SHIPPING"]);

export const affiliateStatus = pgEnum("affiliate_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
]);

export const commissionStatus = pgEnum("commission_status", ["PENDING", "APPROVED", "PAID", "VOID"]);

export const payoutStatus = pgEnum("payout_status", ["PENDING", "APPROVED", "DECLINED", "PAID"]);

export const abandonedCartStatus = pgEnum("abandoned_cart_status", [
  "OPEN",
  "EMAILED",
  "RECOVERED",
  "EXPIRED",
]);

export const reviewStatus = pgEnum("review_status", ["PENDING", "APPROVED", "REJECTED"]);

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: adminRole("role").notNull().default("STAFF"),
  /** Authenticator app secret (base32). Set once the app has been confirmed with a code. */
  totpSecret: text("totp_secret"),
  /** A secret that has been shown as a QR code but not confirmed yet. */
  totpPendingSecret: text("totp_pending_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** The 30-second window of the last code accepted, so a code can't be used twice. */
  totpLastStep: integer("totp_last_step"),
  /** Set when the master account takes this person's access away. They can't sign in after that. */
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  /** Where this person's payouts are sent when they are sent by hand, e.g. "Zelle 407-555-0100". Never a card number. */
  payoutHandle: text("payout_handle"),
  /** The federal income tax rate this person plans with, in basis points. Only used to suggest what to set aside. */
  incomeTaxBps: integer("income_tax_bps").notNull().default(2200),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * An invitation to join the admin. The account already exists, with a password
 * nobody can type (`INVITED_PASSWORD`); following the emailed link sets a real one.
 * The link works once and only its hash is stored. A row with no hash is waiting
 * for its email to be sent.
 */
export const adminInvites = pgTable("admin_invites", {
  id: id(),
  adminId: uuid("admin_id")
    .notNull()
    .unique()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").unique(),
  invitedBy: text("invited_by").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Between a correct password and a correct authenticator code. The browser holds
 * a random token in a short-lived cookie; only its hash is stored.
 */
export const adminLoginChallenges = pgTable("admin_login_challenges", {
  id: id(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** A "forgot my password" link that has been emailed. Works once, for a short time. Stored hashed. */
export const adminPasswordResets = pgTable(
  "admin_password_resets",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("admin_password_resets_admin_idx").on(t.adminId)],
);

/** One-time codes for signing in when the phone with the authenticator app is gone. Stored hashed. */
export const adminRecoveryCodes = pgTable(
  "admin_recovery_codes",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("admin_recovery_codes_admin_idx").on(t.adminId)],
);

/** A signed-in admin. The cookie holds a random token; only its hash is stored. */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("admin_sessions_admin_idx").on(t.adminId)],
);

/** Failed sign-ins, kept briefly so repeated guessing can be slowed down. */
export const adminLoginAttempts = pgTable(
  "admin_login_attempts",
  {
    id: id(),
    /** What the attempt is counted against: "email:<address>" or "ip:<address>". */
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("admin_login_attempts_key_idx").on(t.key, t.createdAt)],
);

export const storeSettings = pgTable("store_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export const categories = pgTable(
  "categories",
  {
    id: id(),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("categories_kind_sort_idx").on(t.kind, t.sortOrder)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    shortDescription: text("short_description"),
    description: text("description"),
    detailsText: text("details_text"), // fabric, weight, print method
    fitText: text("fit_text"), // fit notes, model size
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    /** Lowest variant price, shown on cards. The variant price is what gets charged. */
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    isActive: boolean("is_active").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    fulfillmentProvider: fulfillmentProvider("fulfillment_provider").notNull().default("MANUAL"),
    externalProductId: text("external_product_id"),
    productionDaysMin: integer("production_days_min"),
    productionDaysMax: integer("production_days_max"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_active_sort_idx").on(t.isActive, t.sortOrder),
    index("products_created_idx").on(t.createdAt),
    check("products_price_nonneg", sql`${t.priceCents} >= 0`),
  ],
);

/**
 * Which categories a product is in. Many to many, so one tee can be in
 * T-Shirts, Gaming and Halloween at once. The second index makes
 * "all products in this category" fast for the storefront and the admin list.
 */
export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    /** Position of the product inside this category, for hand-ordered category pages. */
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index("product_categories_category_idx").on(t.categoryId, t.sortOrder),
  ],
);

export const productColors = pgTable(
  "product_colors",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hex: text("hex").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("product_colors_product_name_uq").on(t.productId, t.name)],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** When set, the image shows only for that color so swatches can swap the photo. */
    colorId: uuid("color_id").references(() => productColors.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    altText: text("alt_text").notNull().default(""),
    width: integer("width"),
    height: integer("height"),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId, t.sortOrder)],
);

/** One sellable unit: a product in one color and one size. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    colorId: uuid("color_id")
      .notNull()
      .references(() => productColors.id, { onDelete: "cascade" }),
    size: text("size").notNull(),
    sku: text("sku").notNull().unique(),
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    /** Internal only. What the printer charges us. */
    costCents: integer("cost_cents"),
    externalVariantId: text("external_variant_id"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("product_variants_product_color_size_uq").on(t.productId, t.colorId, t.size),
    check("product_variants_price_nonneg", sql`${t.priceCents} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Customers and orders                                                */
/* ------------------------------------------------------------------ */

export const customers = pgTable("customers", {
  id: id(),
  /** Always stored lowercase. */
  email: text("email").notNull().unique(),
  name: text("name"),
  phone: text("phone"),
  defaultAddress: jsonb("default_address").$type<Address>(),
  /** Agreed to marketing emails. Order emails don't depend on this. */
  acceptsEmail: boolean("accepts_email").notNull().default(false),
  acceptsSms: boolean("accepts_sms").notNull().default(false),
  /** The owner's own notes. Never shown to the customer. */
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    /** Customer-facing number. Order lookup requires this plus the email. */
    orderNumber: text("order_number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    status: orderStatus("status").notNull().default("PENDING"),
    currency: text("currency").notNull().default("usd"),

    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),

    discountCodeId: uuid("discount_code_id").references(() => discountCodes.id, {
      onDelete: "set null",
    }),
    discountCodeText: text("discount_code_text"),

    paymentProvider: text("payment_provider"),
    /** The processor's id for this payment. Unique so one payment can never pay two orders. */
    paymentRef: text("payment_ref").unique(),
    paymentStatus: paymentStatus("payment_status").notNull().default("UNPAID"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** How much of the total has been given back, across every refund. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /**
     * Internal only. What this order actually cost to make and send, typed in from
     * the printer's bill. When empty, the cost of each item is used instead.
     */
    costCents: integer("cost_cents"),
    /** Internal only. The card fee the processor took, once it has told us. */
    processingFeeCents: integer("processing_fee_cents"),

    shippingName: text("shipping_name").notNull(),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
    shippingMethod: text("shipping_method"),

    fulfillmentProvider: fulfillmentProvider("fulfillment_provider").notNull().default("MANUAL"),
    fulfillmentStatus: fulfillmentStatus("fulfillment_status").notNull().default("UNSUBMITTED"),
    externalOrderId: text("external_order_id"),
    fulfillmentSubmittedAt: timestamp("fulfillment_submitted_at", { withTimezone: true }),
    fulfillmentError: text("fulfillment_error"),
    shippingCarrier: text("shipping_carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    affiliateId: uuid("affiliate_id").references(() => affiliates.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_created_idx").on(t.status, t.createdAt),
    index("orders_fulfillment_status_idx").on(t.fulfillmentStatus),
    index("orders_email_idx").on(t.email),
    check("orders_total_nonneg", sql`${t.totalCents} >= 0`),
    check("orders_cost_nonneg", sql`${t.costCents} IS NULL OR ${t.costCents} >= 0`),
    check(
      "orders_refund_within_total",
      sql`${t.refundedCents} >= 0 AND ${t.refundedCents} <= ${t.totalCents}`,
    ),
  ],
);

/** Line items snapshot the product at purchase time, so later catalog edits never change an order. */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    colorName: text("color_name").notNull(),
    size: text("size").notNull(),
    sku: text("sku").notNull(),
    imageUrl: text("image_url"),
    externalVariantId: text("external_variant_id"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents"),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("order_items_quantity_pos", sql`${t.quantity} > 0`),
  ],
);

/** Append-only history of what happened to an order. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    actor: text("actor").notNull().default("system"),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

/** Every webhook we process is recorded once, so replays are ignored. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("webhook_events_provider_event_uq").on(t.provider, t.eventId)],
);

/* ------------------------------------------------------------------ */
/* Discounts                                                           */
/* ------------------------------------------------------------------ */

export const discountCodes = pgTable(
  "discount_codes",
  {
    id: id(),
    /** Always stored uppercase. */
    code: text("code").notNull().unique(),
    type: discountType("type").notNull(),
    /** PERCENTAGE: 1 to 100. FIXED: cents. FREE_SHIPPING: not used, kept at 0. */
    value: integer("value").notNull(),
    /** The owner's own reminder of what the code is for. Never shown to customers. */
    note: text("note"),
    minOrderCents: integer("min_order_cents").notNull().default(0),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    perCustomerLimit: integer("per_customer_limit"),
    isActive: boolean("is_active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    affiliateId: uuid("affiliate_id").references((): AnyPgColumn => affiliates.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "discount_codes_value_pos",
      sql`${t.value} > 0 OR ${t.type}::text = 'FREE_SHIPPING'`,
    ),
    // The database itself refuses to count past the limit, even if two checkouts race.
    check(
      "discount_codes_usage_within_limit",
      sql`${t.maxUses} IS NULL OR ${t.usedCount} <= ${t.maxUses}`,
    ),
  ],
);

export const discountRedemptions = pgTable(
  "discount_redemptions",
  {
    id: id(),
    discountCodeId: uuid("discount_code_id")
      .notNull()
      .references(() => discountCodes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("discount_redemptions_code_email_idx").on(t.discountCodeId, t.email)],
);

/* ------------------------------------------------------------------ */
/* Affiliates                                                          */
/* ------------------------------------------------------------------ */

export const affiliates = pgTable("affiliates", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  slug: text("slug").notNull().unique(),
  status: affiliateStatus("status").notNull().default("PENDING"),
  passwordHash: text("password_hash"),
  inviteTokenHash: text("invite_token_hash").unique(),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpires: timestamp("password_reset_expires", { withTimezone: true }),
  /** Basis points of order profit. 2000 = 20%. */
  commissionFirstOrderBps: integer("commission_first_order_bps").notNull().default(2000),
  commissionRecurringBps: integer("commission_recurring_bps").notNull().default(1500),
  payoutMethod: text("payout_method"),
  payoutEmail: text("payout_email"),
  referredByAffiliateId: uuid("referred_by_affiliate_id").references(
    (): AnyPgColumn => affiliates.id,
    { onDelete: "set null" },
  ),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const affiliateClicks = pgTable(
  "affiliate_clicks",
  {
    id: id(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => affiliates.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    landingPath: text("landing_path"),
    referrer: text("referrer"),
    createdAt: createdAt(),
  },
  (t) => [index("affiliate_clicks_affiliate_idx").on(t.affiliateId, t.createdAt)],
);

export const payoutRequests = pgTable(
  "payout_requests",
  {
    id: id(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => affiliates.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    payoutMethod: text("payout_method").notNull(),
    payoutDetails: text("payout_details"),
    status: payoutStatus("status").notNull().default("PENDING"),
    adminNote: text("admin_note"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("payout_requests_affiliate_idx").on(t.affiliateId)],
);

export const affiliateCommissions = pgTable(
  "affiliate_commissions",
  {
    id: id(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => affiliates.id, { onDelete: "cascade" }),
    /** One commission per order. */
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderTotalCents: integer("order_total_cents").notNull(),
    profitCents: integer("profit_cents").notNull(),
    rateBps: integer("rate_bps").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: commissionStatus("status").notNull().default("PENDING"),
    payoutRequestId: uuid("payout_request_id").references(() => payoutRequests.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("affiliate_commissions_affiliate_idx").on(t.affiliateId, t.status)],
);

/* ------------------------------------------------------------------ */
/* Accounting and partner payouts                                      */
/* ------------------------------------------------------------------ */

/** Money the business spent that isn't tied to one order: ads, samples, filing fees. */
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    /** The day it was spent, on the store's calendar. */
    spentOn: date("spent_on").notNull(),
    /** One of EXPENSE_CATEGORIES in src/lib/accounting/categories.ts. */
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    addedBy: text("added_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("expenses_spent_on_idx").on(t.spentOn),
    check("expenses_amount_pos", sql`${t.amountCents} > 0`),
  ],
);

/**
 * A cost that repeats, like a subscription. It counts once on its start day and
 * again every month or year after, until its end day if it has one.
 */
export const recurringCosts = pgTable(
  "recurring_costs",
  {
    id: id(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** "MONTH" or "YEAR". */
    every: text("every").notNull(),
    startsOn: date("starts_on").notNull(),
    /** The last day it can be charged. Empty while it is still running. */
    endsOn: date("ends_on"),
    addedBy: text("added_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("recurring_costs_amount_pos", sql`${t.amountCents} > 0`),
    check("recurring_costs_every", sql`${t.every} IN ('MONTH', 'YEAR')`),
  ],
);

/**
 * Each partner's share of the profit, and when it started. A change adds a row
 * and never rewrites one, so profit made before the change keeps its old split.
 */
export const profitShares = pgTable(
  "profit_shares",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    /** Basis points of profit. 3333 = 33.33%. */
    shareBps: integer("share_bps").notNull(),
    /** The first day, on the store's calendar, this share applies to. */
    effectiveOn: date("effective_on").notNull(),
    setBy: text("set_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("profit_shares_admin_idx").on(t.adminId, t.effectiveOn),
    check("profit_shares_range", sql`${t.shareBps} >= 0 AND ${t.shareBps} <= 10000`),
  ],
);

/**
 * Money a partner has cashed out. REQUESTED: they asked, and it has come off
 * their balance. SENT: the money has gone. CANCELLED: it was called off and is
 * back on their balance.
 */
export const partnerPayouts = pgTable(
  "partner_payouts",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    /** How it is paid: "manual" until a card payout service is connected. */
    method: text("method").notNull().default("manual"),
    /** Where it was sent, as shown to people. Never a full card number. */
    destination: text("destination"),
    /** The sums behind the amount, exactly as they stood when it was cashed out. */
    receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull(),
    note: text("note"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    index("partner_payouts_admin_idx").on(t.adminId, t.requestedAt),
    check("partner_payouts_amount_pos", sql`${t.amountCents} > 0`),
    check("partner_payouts_status", sql`${t.status} IN ('REQUESTED', 'SENT', 'CANCELLED')`),
  ],
);

/** A correction the master account made to one partner's balance, up or down, with the reason. */
export const payoutAdjustments = pgTable(
  "payout_adjustments",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    /** Positive adds to the balance, negative takes away. */
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    addedBy: text("added_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("payout_adjustments_admin_idx").on(t.adminId),
    check("payout_adjustments_nonzero", sql`${t.amountCents} <> 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

export const subscribers = pgTable("subscribers", {
  id: id(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  source: text("source"),
  isEmailSubscribed: boolean("is_email_subscribed").notNull().default(true),
  isSmsSubscribed: boolean("is_sms_subscribed").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Addresses that asked to stop getting marketing emails. Checked on every
 * campaign send, whatever the customer or subscriber record says.
 */
export const emailOptouts = pgTable("email_optouts", {
  /** Always stored lowercase. */
  email: text("email").primaryKey(),
  /** "link" (the unsubscribe page), "one_click" (the mail app's own button) or "admin". */
  source: text("source").notNull(),
  createdAt: createdAt(),
});

export const campaignStatus = pgEnum("campaign_status", ["DRAFT", "SENDING", "SENT"]);

/** A marketing email written in the admin and sent to everyone who agreed to get them. */
export const campaigns = pgTable("campaigns", {
  id: id(),
  subject: text("subject").notNull(),
  /** The line mail apps show after the subject. */
  preheader: text("preheader"),
  /** The big line at the top of the email. The subject is used when this is empty. */
  heading: text("heading"),
  /** Plain text. A blank line starts a new paragraph. */
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  buttonLabel: text("button_label"),
  buttonUrl: text("button_url"),
  /** A code to show in the email. The button applies it for whoever taps through. */
  discountCodeId: uuid("discount_code_id").references(() => discountCodes.id, {
    onDelete: "set null",
  }),
  status: campaignStatus("status").notNull().default("DRAFT"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

/** One row per person a campaign goes to, so nobody can be sent the same campaign twice. */
export const campaignSends = pgTable(
  "campaign_sends",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    /** In this person's unsubscribe link. Random, so it can't be guessed for someone else. */
    token: text("token").notNull().unique(),
    /**
     * PENDING: waiting. SENDING: handed to the email service, answer not recorded yet.
     * SENT, FAILED (refused) or SKIPPED (unsubscribed first): finished.
     */
    status: text("status").notNull().default("PENDING"),
    /**
     * Names the request this row was sent in. If the answer to that request is
     * lost, the same people are sent again under the same name, and the email
     * service recognises the repeat instead of sending twice.
     */
    batchKey: text("batch_key"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("campaign_sends_campaign_email_uq").on(t.campaignId, t.email),
    index("campaign_sends_status_idx").on(t.campaignId, t.status),
  ],
);

export const abandonedCarts = pgTable(
  "abandoned_carts",
  {
    id: id(),
    email: text("email").notNull(),
    items: jsonb("items").$type<CartSnapshotItem[]>().notNull(),
    totalCents: integer("total_cents").notNull(),
    status: abandonedCartStatus("status").notNull().default("OPEN"),
    recoveryToken: text("recovery_token").notNull().unique(),
    recoveryDiscountCodeId: uuid("recovery_discount_code_id").references(() => discountCodes.id, {
      onDelete: "set null",
    }),
    recoveredOrderId: uuid("recovered_order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    lastEmailedAt: timestamp("last_emailed_at", { withTimezone: true }),
    /** How many reminders have gone out for this cart. */
    emailsSent: integer("emails_sent").notNull().default(0),
    /** The payment page that was opened for this cart, to match it to the order if they pay. */
    paymentOrderRef: text("payment_order_ref"),
    /** When the customer last started checkout with this cart. Reminders count from here. */
    leftAt: timestamp("left_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("abandoned_carts_status_idx").on(t.status, t.createdAt),
    index("abandoned_carts_email_idx").on(t.email),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    email: text("email").notNull(),
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    photoUrl: text("photo_url"),
    sizePurchased: text("size_purchased"),
    /** True only when tied to a real paid order. */
    isVerified: boolean("is_verified").notNull().default(false),
    status: reviewStatus("status").notNull().default("PENDING"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reviews_product_status_idx").on(t.productId, t.status),
    check("reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 5`),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const categoriesRelations = relations(categories, ({ many }) => ({
  productCategories: many(productCategories),
}));

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, { fields: [productCategories.productId], references: [products.id] }),
  category: one(categories, {
    fields: [productCategories.categoryId],
    references: [categories.id],
  }),
}));

export const productsRelations = relations(products, ({ many }) => ({
  productCategories: many(productCategories),
  colors: many(productColors),
  images: many(productImages),
  variants: many(productVariants),
  reviews: many(reviews),
}));

export const productColorsRelations = relations(productColors, ({ one, many }) => ({
  product: one(products, { fields: [productColors.productId], references: [products.id] }),
  images: many(productImages),
  variants: many(productVariants),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
  color: one(productColors, { fields: [productImages.colorId], references: [productColors.id] }),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  color: one(productColors, { fields: [productVariants.colorId], references: [productColors.id] }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  discountCode: one(discountCodes, {
    fields: [orders.discountCodeId],
    references: [discountCodes.id],
  }),
  affiliate: one(affiliates, { fields: [orders.affiliateId], references: [affiliates.id] }),
  items: many(orderItems),
  events: many(orderEvents),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));

export const discountCodesRelations = relations(discountCodes, ({ one, many }) => ({
  affiliate: one(affiliates, { fields: [discountCodes.affiliateId], references: [affiliates.id] }),
  redemptions: many(discountRedemptions),
}));

export const discountRedemptionsRelations = relations(discountRedemptions, ({ one }) => ({
  discountCode: one(discountCodes, {
    fields: [discountRedemptions.discountCodeId],
    references: [discountCodes.id],
  }),
  order: one(orders, { fields: [discountRedemptions.orderId], references: [orders.id] }),
}));

export const affiliatesRelations = relations(affiliates, ({ many }) => ({
  clicks: many(affiliateClicks),
  commissions: many(affiliateCommissions),
  payoutRequests: many(payoutRequests),
  discountCodes: many(discountCodes),
}));

export const affiliateClicksRelations = relations(affiliateClicks, ({ one }) => ({
  affiliate: one(affiliates, { fields: [affiliateClicks.affiliateId], references: [affiliates.id] }),
}));

export const affiliateCommissionsRelations = relations(affiliateCommissions, ({ one }) => ({
  affiliate: one(affiliates, {
    fields: [affiliateCommissions.affiliateId],
    references: [affiliates.id],
  }),
  order: one(orders, { fields: [affiliateCommissions.orderId], references: [orders.id] }),
  payoutRequest: one(payoutRequests, {
    fields: [affiliateCommissions.payoutRequestId],
    references: [payoutRequests.id],
  }),
}));

export const payoutRequestsRelations = relations(payoutRequests, ({ one, many }) => ({
  affiliate: one(affiliates, { fields: [payoutRequests.affiliateId], references: [affiliates.id] }),
  commissions: many(affiliateCommissions),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
}));
