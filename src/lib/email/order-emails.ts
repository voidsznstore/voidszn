import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { PICKUP } from "@/db/queries/admin-manual-orders";
import { customers, orderEvents, orderItems, orders } from "@/db/schema";
import { type Email, isEmailConfigured, sendEmail } from "./send";
import {
  type RenderedEmail,
  orderPlacedEmail,
  orderRefundedEmail,
  orderShippedEmail,
} from "./templates";

/**
 * Emails to customers about their orders. Each one is written to the order's
 * history, sent or not, so it is always clear what the customer was told.
 *
 * Sending never throws: an email that fails must not undo the order change that
 * caused it.
 */

async function loadOrder(orderNumber: string) {
  const db = getDb();
  const [row] = await db
    .select({ order: orders, customerName: customers.name })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!row) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, row.order.id));
  return { ...row, items };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

async function deliver(
  orderNumber: string,
  kind: string,
  label: string,
  render: (loaded: Loaded) => { email: RenderedEmail; key: string },
): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured()) return { sent: false, reason: "Email isn't set up yet." };

  try {
    const loaded = await loadOrder(orderNumber);
    if (!loaded) return { sent: false, reason: "Order not found." };

    const { email, key } = render(loaded);
    const message: Email = { to: loaded.order.email, ...email, idempotencyKey: key };
    const result = await sendEmail(message);

    await getDb()
      .insert(orderEvents)
      .values({
        orderId: loaded.order.id,
        type: result.ok ? `email.${kind}` : "email.failed",
        message: result.ok
          ? `${label} emailed to ${loaded.order.email}`
          : `${label} email could not be sent: ${result.reason}`,
      });
    return result.ok ? { sent: true } : { sent: false, reason: result.reason };
  } catch (error) {
    console.error(`[email] ${label} for ${orderNumber} failed`, error);
    return { sent: false, reason: "Something went wrong sending the email." };
  }
}

/** `again` sends it even though it has gone out before (the owner asked for a resend). */
export const sendOrderPlaced = (orderNumber: string, options: { again?: boolean } = {}) =>
  deliver(orderNumber, "order_placed", "Order confirmation", ({ order, customerName, items }) => ({
    key: `order-placed/${order.orderNumber}${options.again ? `/${Date.now()}` : ""}`,
    email: orderPlacedEmail({
      orderNumber: order.orderNumber,
      customerName: customerName ?? order.shippingName,
      items,
      discountCents: order.discountCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      shippingName: order.shippingName,
      shippingAddress: order.shippingAddress,
      isPickup: order.shippingMethod === PICKUP,
      isPaid: order.status !== "PENDING",
    }),
  }));

export const sendOrderShipped = (orderNumber: string) =>
  deliver(orderNumber, "order_shipped", "Shipping update", ({ order, customerName }) => ({
    // Changing the tracking number is a different email. Pressing save twice is not.
    key: `order-shipped/${order.orderNumber}/${order.trackingNumber ?? "none"}`,
    email: orderShippedEmail({
      orderNumber: order.orderNumber,
      customerName: customerName ?? order.shippingName,
      carrier: order.shippingCarrier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    }),
  }));

export const sendOrderRefunded = (orderNumber: string, amountCents: number) =>
  deliver(orderNumber, "order_refunded", "Refund notice", ({ order, customerName }) => ({
    key: `order-refunded/${order.orderNumber}/${order.refundedCents}`,
    email: orderRefundedEmail({
      orderNumber: order.orderNumber,
      customerName: customerName ?? order.shippingName,
      amountCents,
      isFullRefund: order.refundedCents >= order.totalCents,
    }),
  }));
