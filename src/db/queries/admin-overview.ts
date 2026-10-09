import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import type { Database } from "../index";
import { orderEvents, orders } from "../schema";

/** Numbers and latest orders for the admin overview. */
export async function getOverview(db: Database) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const paid = inArray(orders.status, ["PAID", "IN_PRODUCTION", "SHIPPED", "DELIVERED"]);

  const [[toFulfil], [week], [flagged], recent] = await Promise.all([
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.status, "PAID"), eq(orders.fulfillmentStatus, "UNSUBMITTED"))),
    db
      .select({ orders: count(), revenue: sum(orders.totalCents) })
      .from(orders)
      .where(and(paid, gte(orders.createdAt, weekAgo))),
    db
      .select({ value: sql<number>`count(distinct ${orderEvents.orderId})::int` })
      .from(orderEvents)
      .innerJoin(orders, eq(orders.id, orderEvents.orderId))
      .where(and(eq(orderEvents.type, "order.attention"), eq(orders.status, "PAID"))),
    db
      .select({
        orderNumber: orders.orderNumber,
        shippingName: orders.shippingName,
        totalCents: orders.totalCents,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(5),
  ]);

  return {
    toFulfil: toFulfil.value,
    flagged: flagged.value,
    week: { orders: week.orders, revenueCents: Number(week.revenue ?? 0) },
    recent,
  };
}
