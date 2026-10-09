import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { PICKUP } from "@/db/queries/admin-manual-orders";
import { customers, emailOptouts, orderEvents, orderItems, orders } from "@/db/schema";
import { siteConfig } from "@/lib/site-config";
import { type Email, isEmailConfigured, sendEmail } from "./send";
import { getAutomation, usableEmailDiscount } from "./automation";

/** The unsubscribe page and the one-click header for a token. */
const unsubscribeLinks = (token: string) => ({
  url: `${siteConfig.url}/unsubscribe/${token}`,
  headers: {
    "List-Unsubscribe": `<${siteConfig.url}/api/unsubscribe/${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
});
import {
  type EmailDiscount,
  type RenderedEmail,
  orderCancelledEmail,
  orderDeliveredEmail,
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
  render: (loaded: Loaded) => { email: RenderedEmail; key: string; headers?: Record<string, string> },
): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured()) return { sent: false, reason: "Email isn't set up yet." };

  try {
    const loaded = await loadOrder(orderNumber);
    if (!loaded) return { sent: false, reason: "Order not found." };

    const { email, key, headers } = render(loaded);
    const message: Email = {
      to: loaded.order.email,
      ...email,
      idempotencyKey: key,
      ...(headers ? { headers } : {}),
    };
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
      discountCode: order.discountCodeText,
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

/**
 * Tells the customer it arrived, with the thank-you code if one is set in the
 * admin. The code makes it partly an offer, so it is left out for anyone who has
 * unsubscribed or couldn't use it, and comes with a way to stop getting offers.
 */
export async function sendOrderDelivered(orderNumber: string) {
  let discount: EmailDiscount | null = null;
  let orderId: string | null = null;
  try {
    const db = getDb();
    const [order] = await db
      .select({ id: orders.id, email: orders.email })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);
    if (order) {
      orderId = order.id;
      const [optedOut] = await db
        .select({ email: emailOptouts.email })
        .from(emailOptouts)
        .where(eq(emailOptouts.email, order.email.toLowerCase()))
        .limit(1);
      if (!optedOut) {
        const { delivered } = await getAutomation(db);
        discount = await usableEmailDiscount(db, delivered.discountCodeId, { email: order.email });
      }
    }
  } catch (error) {
    console.error("[email] Could not read the thank-you code", error);
  }
  // The order's own id stands in as the unsubscribe token: random, and only ever
  // sent to the person the order belongs to.
  const stop = discount && orderId ? unsubscribeLinks(orderId) : null;

  return deliver(orderNumber, "order_delivered", "Delivery notice", ({ order, customerName }) => ({
    key: `order-delivered/${order.orderNumber}`,
    headers: stop?.headers,
    email: orderDeliveredEmail({
      orderNumber: order.orderNumber,
      customerName: customerName ?? order.shippingName,
      discount,
      unsubscribeUrl: stop?.url,
    }),
  }));
}

export const sendOrderCancelled = (orderNumber: string) =>
  deliver(orderNumber, "order_cancelled", "Cancellation notice", ({ order, customerName }) => ({
    key: `order-cancelled/${order.orderNumber}`,
    email: orderCancelledEmail({
      orderNumber: order.orderNumber,
      customerName: customerName ?? order.shippingName,
      wasPaid: order.paymentStatus !== "UNPAID",
    }),
  }));
