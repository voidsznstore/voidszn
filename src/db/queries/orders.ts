import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../index";
import { claimDiscountUse } from "./discounts";
import {
  type Address,
  customers,
  discountCodes,
  discountRedemptions,
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
  /** The discount code used, as text, and its record when it still exists. */
  discountCode?: string | null;
  discountCodeId?: string | null;
  /** Ticked "email me new designs and offers" at checkout. */
  wantsMarketing?: boolean;
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

export function newOrderNumber(): string {
  let code = "";
  for (let index = 0; index < 8; index++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `VS-${code}`;
}

export const skuFor = (slug: string, color: string, size: string) =>
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
        discountCodeText: input.discountCode ?? null,
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

    // Count the use of the code and remember who used it. This sits in its own
    // savepoint: the customer has already paid the discounted price, so the order
    // is saved even if this part can't be (say, the code was deleted a moment ago).
    const codeNotes: string[] = [];
    const codeId = input.discountCodeId;
    if (codeId) {
      try {
        await tx.transaction(async (inner) => {
          await inner.update(orders).set({ discountCodeId: codeId }).where(eq(orders.id, order.id));
          const counted = await claimDiscountUse(inner, codeId);
          await inner
            .insert(discountRedemptions)
            .values({ discountCodeId: codeId, orderId: order.id, email })
            .onConflictDoNothing();
          if (!counted) {
            codeNotes.push(
              `Code ${input.discountCode} was switched off, had expired or was used up by the time this order was paid. The payment page was opened while it still worked, so the discount was given.`,
            );
          }
          const [limit] = await inner
            .select({ perCustomer: discountCodes.perCustomerLimit })
            .from(discountCodes)
            .where(eq(discountCodes.id, codeId))
            .limit(1);
          if (limit?.perCustomer) {
            const [uses] = await inner
              .select({ value: sql<number>`count(*)::int` })
              .from(discountRedemptions)
              .where(and(eq(discountRedemptions.discountCodeId, codeId), eq(discountRedemptions.email, email)));
            if ((uses?.value ?? 0) > limit.perCustomer) {
              codeNotes.push(
                `This customer has now used code ${input.discountCode} ${uses.value} times. It is meant to be ${limit.perCustomer} per customer.`,
              );
            }
          }
        });
      } catch (error) {
        console.error("[orders] Could not record the discount code on a paid order", error);
        codeNotes.length = 0;
        codeNotes.push(`Code ${input.discountCode} was used, but its use could not be counted.`);
      }
    }

    await tx.insert(orderEvents).values([
      {
        orderId: order.id,
        type: "order.paid",
        message: "Payment confirmed",
        data: { provider: input.paymentProvider, event: input.event.id },
      },
      ...(input.discountCode
        ? [{ orderId: order.id, type: "discount.used", message: `Used code ${input.discountCode}` }]
        : []),
      // Flagged, so a discount that went past its limits is seen before the order ships.
      ...codeNotes.map((message) => ({ orderId: order.id, type: "order.attention", message })),
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
