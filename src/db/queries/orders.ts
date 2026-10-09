import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  type Address,
  customers,
  orderEvents,
  orderItems,
  orders,
  webhookEvents,
} from "../schema";

export type PaidOrderInput = {
  /** The processor's event, recorded once so replays are ignored. */
  event: { provider: string; id: string; type: string };
  /** The processor's id for the payment. One payment can only ever create one order. */
  paymentRef: string;
  paymentProvider: string;
  email: string;
  customerName: string | null;
  phone: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingName: string;
  shippingAddress: Address;
  shippingMethod: string | null;
  /** Anything a person needs to look at before this order ships. Shown on the order. */
  attention?: string[];
  items: {
    slug: string;
    productName: string;
    colorName: string;
    size: string;
    quantity: number;
    unitPriceCents: number;
    /** Links back to the catalog, when the product still exists. */
    productId?: string | null;
    variantId?: string | null;
    sku?: string | null;
    imageUrl?: string | null;
  }[];
};

export type RecordResult =
  | { status: "created"; orderNumber: string }
  | { status: "order_exists" };

// No 0, O, 1 or I, so a number read over the phone can't be misheard.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function newOrderNumber(): string {
  let code = "";
  for (let index = 0; index < 8; index++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `VS-${code}`;
}

const skuFor = (slug: string, color: string, size: string) =>
  `${slug}-${color}-${size}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-");

/**
 * Writes a paid order. Safe to call more than once for the same payment: the
 * payment reference is unique, so a replayed or second event for the same payment
 * changes nothing. The event itself is kept as a log entry.
 *
 * Everything happens in one transaction. If any part fails, nothing is saved and
 * the processor's retry starts clean.
 */
export async function recordPaidOrder(db: Database, input: PaidOrderInput): Promise<RecordResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(webhookEvents)
      .values({
        provider: input.event.provider,
        eventId: input.event.id,
        type: input.event.type,
        payload: { paymentRef: input.paymentRef },
      })
      .onConflictDoNothing();

    const markProcessed = () =>
      tx
        .update(webhookEvents)
        .set({ processedAt: new Date() })
        .where(
          and(
            eq(webhookEvents.provider, input.event.provider),
            eq(webhookEvents.eventId, input.event.id),
          ),
        );

    const email = input.email.trim().toLowerCase();
    const [customer] = await tx
      .insert(customers)
      .values({
        email,
        name: input.customerName,
        phone: input.phone,
        defaultAddress: input.shippingAddress,
      })
      .onConflictDoUpdate({
        target: customers.email,
        set: {
          // Keep what we already know when this order doesn't supply it.
          name: sql`coalesce(excluded.name, ${customers.name})`,
          phone: sql`coalesce(excluded.phone, ${customers.phone})`,
          defaultAddress: input.shippingAddress,
          updatedAt: new Date(),
        },
      })
      .returning({ id: customers.id });

    const orderNumber = newOrderNumber();
    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber,
        customerId: customer.id,
        email,
        status: "PAID",
        currency: input.currency,
        subtotalCents: input.subtotalCents,
        discountCents: input.discountCents,
        shippingCents: input.shippingCents,
        taxCents: input.taxCents,
        totalCents: input.totalCents,
        paymentProvider: input.paymentProvider,
        paymentRef: input.paymentRef,
        paymentStatus: "PAID",
        paidAt: new Date(),
        shippingName: input.shippingName,
        shippingAddress: input.shippingAddress,
        shippingMethod: input.shippingMethod,
      })
      .onConflictDoNothing({ target: orders.paymentRef })
      .returning({ id: orders.id });

    if (!order) {
      await markProcessed();
      return { status: "order_exists" };
    }

    await tx.insert(orderItems).values(
      input.items.map((item) => ({
        orderId: order.id,
        productName: item.productName,
        colorName: item.colorName,
        size: item.size,
        productId: item.productId ?? null,
        variantId: item.variantId ?? null,
        sku: item.sku ?? skuFor(item.slug, item.colorName, item.size),
        imageUrl: item.imageUrl ?? null,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      })),
    );

    await tx.insert(orderEvents).values([
      {
        orderId: order.id,
        type: "order.paid",
        message: "Payment confirmed",
        data: { provider: input.paymentProvider, event: input.event.id },
      },
      ...(input.attention ?? []).map((message) => ({
        orderId: order.id,
        type: "order.attention",
        message,
      })),
    ]);

    await markProcessed();
    return { status: "created", orderNumber };
  });
}

/** Records an event that needs no order change, so it is not processed twice. */
export async function recordEvent(
  db: Database,
  event: { provider: string; id: string; type: string },
): Promise<void> {
  await db
    .insert(webhookEvents)
    .values({ provider: event.provider, eventId: event.id, type: event.type, processedAt: new Date() })
    .onConflictDoNothing();
}

export async function findOrderNumberByPaymentRef(
  db: Database,
  paymentRef: string,
): Promise<string | null> {
  const [order] = await db
    .select({ orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.paymentRef, paymentRef))
    .limit(1);
  return order?.orderNumber ?? null;
}
