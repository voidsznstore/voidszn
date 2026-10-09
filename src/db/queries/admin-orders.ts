import { and, asc, count, desc, eq, exists, gte, ilike, inArray, notExists, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  type Address,
  categories,
  orderEvents,
  orderItems,
  orders,
  productCategories,
} from "../schema";

const ATTENTION = "order.attention";
const ATTENTION_RESOLVED = "order.attention_resolved";

/** True for orders flagged for a person to look at and not yet marked as dealt with. */
const needsAttention = (db: Database) =>
  and(
    exists(
      db
        .select({ one: sql`1` })
        .from(orderEvents)
        .where(and(eq(orderEvents.orderId, orders.id), eq(orderEvents.type, ATTENTION))),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(orderEvents)
        .where(and(eq(orderEvents.orderId, orders.id), eq(orderEvents.type, ATTENTION_RESOLVED))),
    ),
  );

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export const ORDER_VIEWS = {
  all: "All",
  "to-fulfil": "To fulfil",
  "in-production": "In production",
  shipped: "Shipped",
  attention: "Need attention",
  cancelled: "Cancelled",
} as const;
export type OrderView = keyof typeof ORDER_VIEWS;

export const ORDER_SORTS = {
  newest: "Newest",
  oldest: "Oldest",
  "total-desc": "Largest total",
} as const;
export type OrderSort = keyof typeof ORDER_SORTS;

export type OrderFilters = {
  view?: OrderView;
  q?: string;
  /** Category id. Matches orders with at least one product from that category. */
  category?: string;
  sort?: OrderSort;
};

export type AdminOrderRow = {
  orderNumber: string;
  createdAt: Date;
  shippingName: string;
  email: string;
  totalCents: number;
  status: (typeof orders.$inferSelect)["status"];
  units: number;
  flagged: boolean;
};

export async function listOrders(db: Database, filters: OrderFilters): Promise<AdminOrderRow[]> {
  const q = filters.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;

  const view = (() => {
    switch (filters.view) {
      case "to-fulfil":
        return and(eq(orders.status, "PAID"), eq(orders.fulfillmentStatus, "UNSUBMITTED"));
      case "in-production":
        return eq(orders.status, "IN_PRODUCTION");
      case "shipped":
        return inArray(orders.status, ["SHIPPED", "DELIVERED"]);
      case "cancelled":
        return inArray(orders.status, ["CANCELLED", "REFUNDED"]);
      case "attention":
        return needsAttention(db);
      default:
        return undefined;
    }
  })();

  const flagged = sql<boolean>`${needsAttention(db)}`;
  const units = sql<number>`(select coalesce(sum(${orderItems.quantity}), 0)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`;

  return db
    .select({
      orderNumber: orders.orderNumber,
      createdAt: orders.createdAt,
      shippingName: orders.shippingName,
      email: orders.email,
      totalCents: orders.totalCents,
      status: orders.status,
      units,
      flagged,
    })
    .from(orders)
    .where(
      and(
        view,
        pattern
          ? or(
              ilike(orders.orderNumber, pattern),
              ilike(orders.email, pattern),
              ilike(orders.shippingName, pattern),
            )
          : undefined,
        filters.category
          ? exists(
              db
                .select({ one: sql`1` })
                .from(orderItems)
                .innerJoin(productCategories, eq(productCategories.productId, orderItems.productId))
                .where(
                  and(
                    eq(orderItems.orderId, orders.id),
                    eq(productCategories.categoryId, filters.category),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(
      filters.sort === "oldest"
        ? asc(orders.createdAt)
        : filters.sort === "total-desc"
          ? desc(orders.totalCents)
          : desc(orders.createdAt),
    )
    .limit(300);
}

/** How many orders sit in each view, for the tabs. */
export async function countOrderViews(db: Database): Promise<Record<OrderView, number>> {
  const [[all], [toFulfil], [inProduction], [shipped], [attention], [cancelled]] =
    await Promise.all([
      db.select({ value: count() }).from(orders),
      db
        .select({ value: count() })
        .from(orders)
        .where(and(eq(orders.status, "PAID"), eq(orders.fulfillmentStatus, "UNSUBMITTED"))),
      db.select({ value: count() }).from(orders).where(eq(orders.status, "IN_PRODUCTION")),
      db
        .select({ value: count() })
        .from(orders)
        .where(inArray(orders.status, ["SHIPPED", "DELIVERED"])),
      db.select({ value: count() }).from(orders).where(needsAttention(db)),
      db
        .select({ value: count() })
        .from(orders)
        .where(inArray(orders.status, ["CANCELLED", "REFUNDED"])),
    ]);
  return {
    all: all.value,
    "to-fulfil": toFulfil.value,
    "in-production": inProduction.value,
    shipped: shipped.value,
    attention: attention.value,
    cancelled: cancelled.value,
  };
}

/* ------------------------------------------------------------------ */
/* One order                                                           */
/* ------------------------------------------------------------------ */

export async function getOrderDetail(db: Database, orderNumber: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!order) return null;

  const [items, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.id))
      .orderBy(desc(orderEvents.createdAt)),
  ]);

  const flags = events.filter((event) => event.type === ATTENTION);
  const resolved = events.some((event) => event.type === ATTENTION_RESOLVED);
  return { order, items, events, attention: resolved ? [] : flags.map((flag) => flag.message ?? "") };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

/** A problem the person using the admin can fix. Shown to them as written. */
export class OrderError extends Error {}

type Change = Partial<typeof orders.$inferInsert>;

/**
 * Applies a change to an order and writes it to the order's history, together.
 * `allowed` lists the statuses the order must be in for the change to make sense.
 */
async function change(
  db: Database,
  orderNumber: string,
  actor: string,
  options: {
    allowed?: (typeof orders.$inferSelect)["status"][];
    set: Change;
    event: { type: string; message: string; data?: Record<string, unknown> };
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)
      .for("update");
    if (!order) throw new OrderError("That order no longer exists.");
    if (options.allowed && !options.allowed.includes(order.status)) {
      throw new OrderError("This order has changed since the page loaded. Refresh and try again.");
    }
    if (Object.keys(options.set).length > 0) {
      await tx.update(orders).set(options.set).where(eq(orders.id, order.id));
    }
    await tx.insert(orderEvents).values({ orderId: order.id, actor, ...options.event });
  });
}

export const markInProduction = (db: Database, orderNumber: string, actor: string) =>
  change(db, orderNumber, actor, {
    allowed: ["PAID"],
    set: {
      status: "IN_PRODUCTION",
      fulfillmentStatus: "SUBMITTED",
      fulfillmentSubmittedAt: new Date(),
    },
    event: { type: "order.in_production", message: "Sent to the printer" },
  });

export const markShipped = (
  db: Database,
  orderNumber: string,
  actor: string,
  tracking: { carrier: string; number: string; url: string },
) =>
  change(db, orderNumber, actor, {
    allowed: ["PAID", "IN_PRODUCTION", "SHIPPED"],
    set: {
      status: "SHIPPED",
      fulfillmentStatus: "SHIPPED",
      shippedAt: new Date(),
      shippingCarrier: tracking.carrier || null,
      trackingNumber: tracking.number || null,
      trackingUrl: tracking.url || null,
    },
    event: {
      type: "order.shipped",
      message: tracking.number
        ? `Shipped${tracking.carrier ? ` with ${tracking.carrier}` : ""}, tracking ${tracking.number}`
        : "Shipped",
    },
  });

export const markDelivered = (db: Database, orderNumber: string, actor: string) =>
  change(db, orderNumber, actor, {
    allowed: ["SHIPPED"],
    set: { status: "DELIVERED", fulfillmentStatus: "DELIVERED", deliveredAt: new Date() },
    event: { type: "order.delivered", message: "Marked as delivered" },
  });

export const cancelOrder = (db: Database, orderNumber: string, actor: string, reason: string) =>
  change(db, orderNumber, actor, {
    allowed: ["PAID", "IN_PRODUCTION"],
    set: { status: "CANCELLED", fulfillmentStatus: "CANCELLED" },
    event: {
      type: "order.cancelled",
      message: reason ? `Cancelled: ${reason}` : "Cancelled",
    },
  });

export const updateShippingAddress = (
  db: Database,
  orderNumber: string,
  actor: string,
  shipping: { name: string; address: Address },
) =>
  change(db, orderNumber, actor, {
    allowed: ["PAID", "IN_PRODUCTION"],
    set: { shippingName: shipping.name, shippingAddress: shipping.address },
    event: { type: "order.address_updated", message: "Shipping address updated" },
  });

export const resolveAttention = (db: Database, orderNumber: string, actor: string) =>
  change(db, orderNumber, actor, {
    set: {},
    event: { type: ATTENTION_RESOLVED, message: "Marked as dealt with" },
  });

export const addNote = (db: Database, orderNumber: string, actor: string, note: string) =>
  change(db, orderNumber, actor, {
    set: {},
    event: { type: "order.note", message: note },
  });

/* ------------------------------------------------------------------ */
/* Sales by category                                                   */
/* ------------------------------------------------------------------ */

export type CategorySales = {
  id: string | null;
  name: string;
  kind: "PRODUCT_TYPE" | "INTEREST" | null;
  units: number;
  revenueCents: number;
  orders: number;
};

/**
 * What sold in each category over the last `days` days, counting paid orders
 * only. Revenue is the price of the items, without shipping or tax. A product in
 * several interests counts toward each of them, so interest rows can add up to
 * more than the total.
 */
export async function getSalesByCategory(
  db: Database,
  days: number,
): Promise<{ categories: CategorySales[]; total: Omit<CategorySales, "id" | "name" | "kind"> }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const paid = and(
    inArray(orders.status, ["PAID", "IN_PRODUCTION", "SHIPPED", "DELIVERED"]),
    gte(orders.createdAt, since),
  );
  const units = sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`;
  const revenue = sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPriceCents}), 0)::int`;
  const orderCount = sql<number>`count(distinct ${orders.id})::int`;

  const [byCategory, [total], [categorised]] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        units,
        revenueCents: revenue,
        orders: orderCount,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(productCategories, eq(productCategories.productId, orderItems.productId))
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(paid)
      .groupBy(categories.id)
      .orderBy(asc(categories.kind), desc(revenue)),
    db
      .select({ units, revenueCents: revenue, orders: orderCount })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(paid),
    // Items whose product has a product type. The rest are reported as uncategorised.
    db
      .select({ units, revenueCents: revenue, orders: orderCount })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(
          paid,
          exists(
            db
              .select({ one: sql`1` })
              .from(productCategories)
              .innerJoin(categories, eq(categories.id, productCategories.categoryId))
              .where(
                and(
                  eq(productCategories.productId, orderItems.productId),
                  eq(categories.kind, "PRODUCT_TYPE"),
                ),
              ),
          ),
        ),
      ),
  ]);

  const rows: CategorySales[] = [...byCategory];
  if (total.units > categorised.units) {
    rows.push({
      id: null,
      name: "No product type",
      kind: "PRODUCT_TYPE",
      units: total.units - categorised.units,
      revenueCents: total.revenueCents - categorised.revenueCents,
      orders: 0,
    });
  }
  return { categories: rows, total };
}
