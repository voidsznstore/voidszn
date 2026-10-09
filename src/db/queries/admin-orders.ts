import { and, asc, count, desc, eq, exists, gte, ilike, inArray, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
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

/**
 * True for orders flagged for a person to look at and not yet marked as dealt
 * with. A flag raised after the last "dealt with" counts as open again.
 */
const needsAttention = (db: Database) => {
  const lastResolved = sql`(select max(resolved.created_at) from ${orderEvents} resolved where resolved.order_id = ${orders.id} and resolved.type = ${ATTENTION_RESOLVED})`;
  return exists(
    db
      .select({ one: sql`1` })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, orders.id),
          eq(orderEvents.type, ATTENTION),
          sql`(${lastResolved} is null or ${orderEvents.createdAt} > ${lastResolved})`,
        ),
      ),
  );
};

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export const ORDER_VIEWS = {
  all: "All",
  unpaid: "Not paid",
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
      case "unpaid":
        return eq(orders.status, "PENDING");
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
  // Wrapped once more on purpose: in a one-table query the library drops table names
  // from columns written straight into a selected field, and "id" would then mean
  // the item's own id inside the sub-query.
  const units = sql<number>`${sql`(select coalesce(sum(${orderItems.quantity}), 0)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`}`;

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
  const [[all], [unpaid], [toFulfil], [inProduction], [shipped], [attention], [cancelled]] =
    await Promise.all([
      db.select({ value: count() }).from(orders),
      db.select({ value: count() }).from(orders).where(eq(orders.status, "PENDING")),
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
    unpaid: unpaid.value,
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

  // Flags raised since the last time the order was marked as dealt with.
  const lastResolved = events.find((event) => event.type === ATTENTION_RESOLVED)?.createdAt;
  const attention = events
    .filter(
      (event) => event.type === ATTENTION && (!lastResolved || event.createdAt > lastResolved),
    )
    .map((flag) => flag.message ?? "");
  return { order, items, events, attention };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

/** A problem the person using the admin can fix. Shown to them as written. */
export class OrderError extends Error {}

type Change = PgUpdateSetSource<typeof orders>;

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
    allowed: ["PENDING", "PAID", "IN_PRODUCTION"],
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
    allowed: ["PENDING", "PAID", "IN_PRODUCTION"],
    // An order that was down as a pickup is a shipped order once it has an address.
    set: {
      shippingName: shipping.name,
      shippingAddress: shipping.address,
      shippingMethod: sql`nullif(${orders.shippingMethod}, 'Pickup')`,
    },
    event: { type: "order.address_updated", message: "Shipping address updated" },
  });

/**
 * Writes a refund that Square has accepted onto the order. `refundedBefore` is what
 * the page showed as already refunded: if that has changed, someone else refunded
 * in the meantime and nothing is written.
 */
export async function recordRefund(
  db: Database,
  orderNumber: string,
  actor: string,
  refund: { amountCents: number; refundedBefore: number; reason: string; refundId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        totalCents: orders.totalCents,
        refundedCents: orders.refundedCents,
      })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)
      .for("update");
    if (!order) throw new OrderError("That order no longer exists.");

    // The same refund recorded twice (a retry) changes nothing the second time.
    const [already] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, order.id),
          eq(orderEvents.type, "order.refunded"),
          sql`${orderEvents.data}->>'refundId' = ${refund.refundId}`,
        ),
      )
      .limit(1);
    if (already) return;

    if (order.refundedCents !== refund.refundedBefore) {
      throw new OrderError("This order has changed since the page loaded. Refresh and try again.");
    }
    const refundedCents = order.refundedCents + refund.amountCents;
    const isFull = refundedCents >= order.totalCents;
    const notShipped = order.status === "PAID" || order.status === "IN_PRODUCTION";

    await tx
      .update(orders)
      .set({
        refundedCents,
        paymentStatus: isFull ? "REFUNDED" : "PARTIALLY_REFUNDED",
        // A full refund closes the order. One that hasn't shipped is taken out of fulfilment too.
        ...(isFull ? { status: "REFUNDED" as const } : {}),
        ...(isFull && notShipped ? { fulfillmentStatus: "CANCELLED" as const } : {}),
      })
      .where(eq(orders.id, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      actor,
      type: "order.refunded",
      message: `Refunded $${(refund.amountCents / 100).toFixed(2)}${isFull ? " (in full)" : ""}${
        refund.reason ? `: ${refund.reason}` : ""
      }`,
      data: { refundId: refund.refundId, amountCents: refund.amountCents },
    });
  });
}

/** Kinds of history entry that each mark one finished refund attempt, successful or not. */
export const REFUND_ATTEMPTS = ["order.refunded", "order.refund_failed"];

/** Writes down a refund Square turned away, so the order's history shows it was tried. */
export const recordRefundRefusal = (
  db: Database,
  orderNumber: string,
  actor: string,
  refusal: { amountCents: number; why: string },
) =>
  change(db, orderNumber, actor, {
    set: {},
    event: {
      type: "order.refund_failed",
      message: `A refund of $${(refusal.amountCents / 100).toFixed(2)} was not made: ${refusal.why}`,
    },
  });

/**
 * Square reported that a refund it had accepted did not go through. The amount
 * is taken back off what the order counts as refunded, so the refund can be
 * tried again, and the order is flagged for a person to look at.
 */
export async function flagFailedRefund(
  db: Database,
  paymentRef: string,
  refund: { id: string; status: string; amountCents: number },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, refundedCents: orders.refundedCents })
      .from(orders)
      .where(eq(orders.paymentRef, paymentRef))
      .limit(1)
      .for("update");
    if (!order) return false;

    const about = (type: string) =>
      and(
        eq(orderEvents.orderId, order.id),
        eq(orderEvents.type, type),
        sql`${orderEvents.data}->>'refundId' = ${refund.id}`,
      );
    // Square can report the same failure more than once.
    const [flagged] = await tx.select({ id: orderEvents.id }).from(orderEvents).where(about(ATTENTION)).limit(1);
    if (flagged) return true;

    // Only a refund that was counted on this order is taken back off it.
    const [counted] = await tx
      .select({ data: orderEvents.data })
      .from(orderEvents)
      .where(about("order.refunded"))
      .limit(1);
    const amount = Number((counted?.data as { amountCents?: number } | null)?.amountCents ?? 0);
    if (counted && amount > 0) {
      const refundedCents = Math.max(0, order.refundedCents - amount);
      await tx
        .update(orders)
        .set({ refundedCents, paymentStatus: refundedCents > 0 ? "PARTIALLY_REFUNDED" : "PAID" })
        .where(eq(orders.id, order.id));
    }

    await tx.insert(orderEvents).values({
      orderId: order.id,
      type: ATTENTION,
      message: `Square could not complete a refund of $${(refund.amountCents / 100).toFixed(2)} (${refund.status.toLowerCase()}). The customer has not been paid back. Try the refund again, or check the payment in Square.`,
      data: { refundId: refund.id },
    });
    return true;
  });
}

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
