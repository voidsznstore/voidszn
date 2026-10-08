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
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

export type CartSnapshotItem = {
  variantId: string;
  quantity: number;
};

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const adminRole = pgEnum("admin_role", ["OWNER", "STAFF"]);

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

export const discountType = pgEnum("discount_type", ["PERCENTAGE", "FIXED"]);

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storeSettings = pgTable("store_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export const categories = pgTable("categories", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
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
    index("products_category_idx").on(t.categoryId),
    check("products_price_nonneg", sql`${t.priceCents} >= 0`),
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
  acceptsEmail: boolean("accepts_email").notNull().default(false),
  acceptsSms: boolean("accepts_sms").notNull().default(false),
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
    /** PERCENTAGE: 1 to 100. FIXED: cents. */
    value: integer("value").notNull(),
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
    check("discount_codes_value_pos", sql`${t.value} > 0`),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("abandoned_carts_status_idx").on(t.status, t.createdAt)],
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
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
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
