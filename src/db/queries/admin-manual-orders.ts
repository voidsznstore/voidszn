import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  type Address,
  customers,
  orderEvents,
  orderItems,
  orders,
  productColors,
  productImages,
  productVariants,
  products,
  webhookEvents,
} from "../schema";
import { OrderError } from "./admin-orders";
import { newOrderNumber, skuFor } from "./orders";

/**
 * Orders the owner adds by hand in the admin: a sale agreed over messages, a
 * one-off design, something handed over in person.
 */

/** Ways a hand-added order can have been paid. Stored as written. */
export const PAYMENT_METHODS = [
  "Cash",
  "Cash App",
  "Zelle",
  "Venmo",
  "PayPal",
  "Card in person",
  "No charge",
  "Other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What `orders.shipping_method` holds when nothing is being shipped. */
export const PICKUP = "Pickup";

/** A product that can be put on a hand-added order, with what it comes in. */
export type OrderProductOption = {
  id: string;
  name: string;
  /** False for products hidden from the store. They can still be sold by hand. */
  isActive: boolean;
  colors: { id: string; name: string }[];
  variants: { id: string; colorId: string; size: string; priceCents: number }[];
};

export async function listOrderProducts(db: Database): Promise<OrderProductOption[]> {
  const [productRows, colorRows, variantRows] = await Promise.all([
    db
      .select({ id: products.id, name: products.name, isActive: products.isActive })
      .from(products)
      .orderBy(desc(products.isActive), asc(products.name)),
    db
      .select({ id: productColors.id, productId: productColors.productId, name: productColors.name })
      .from(productColors)
      .orderBy(asc(productColors.sortOrder), asc(productColors.name)),
    db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        colorId: productVariants.colorId,
        size: productVariants.size,
        priceCents: productVariants.priceCents,
      })
      .from(productVariants)
      .where(eq(productVariants.isActive, true))
      .orderBy(asc(productVariants.sortOrder)),
  ]);

  return productRows
    .map((product) => {
      const variants = variantRows
        .filter((variant) => variant.productId === product.id)
        .map(({ id, colorId, size, priceCents }) => ({ id, colorId, size, priceCents }));
      const inUse = new Set(variants.map((variant) => variant.colorId));
      return {
        ...product,
        colors: colorRows
          .filter((color) => color.productId === product.id && inUse.has(color.id))
          .map(({ id, name }) => ({ id, name })),
        variants,
      };
    })
    .filter((product) => product.variants.length > 0);
}

export type ManualOrderInput = {
  /** Made once by the form. Sending the same form twice makes one order. */
  token: string;
  email: string;
  customerName: string;
  phone: string;
  /** Null when the order is collected or handed over, not shipped. */
  shipTo: Address | null;
  items: (
    | { variantId: string; quantity: number; unitPriceCents: number }
    | { name: string; details: string; size: string; quantity: number; unitPriceCents: number }
  )[];
  shippingCents: number;
  discountCents: number;
  /** Null when the customer hasn't paid yet. */
  paidWith: PaymentMethod | null;
  note: string;
};

export type ManualOrderResult = { orderNumber: string; isNew: boolean };

const NO_ADDRESS: Address = { line1: "", city: "", state: "", postalCode: "", country: "US" };

export async function createManualOrder(
  db: Database,
  actor: string,
  input: ManualOrderInput,
): Promise<ManualOrderResult> {
  return db.transaction(async (tx) => {
    const orderNumber = newOrderNumber();

    // The form's token is written first. If it is already there, this form has
    // been sent before and the order it made is the answer.
    const eventId = `order:${input.token}`;
    const [claimed] = await tx
      .insert(webhookEvents)
      .values({
        provider: "admin",
        eventId,
        type: "order.manual",
        payload: { orderNumber },
        processedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!claimed) {
      const [earlier] = await tx
        .select({ payload: webhookEvents.payload })
        .from(webhookEvents)
        .where(and(eq(webhookEvents.provider, "admin"), eq(webhookEvents.eventId, eventId)))
        .limit(1);
      const existing = earlier?.payload?.orderNumber;
      if (typeof existing !== "string") throw new OrderError("That didn't save. Try again.");
      return { orderNumber: existing, isNew: false };
    }

    // Catalog items: names, SKU and photo come from the catalog as it is now.
    const variantIds = input.items.flatMap((item) => ("variantId" in item ? [item.variantId] : []));
    const variantRows = variantIds.length
      ? await tx
          .select({
            variantId: productVariants.id,
            productId: products.id,
            productName: products.name,
            colorId: productColors.id,
            colorName: productColors.name,
            size: productVariants.size,
            sku: productVariants.sku,
          })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .innerJoin(productColors, eq(productColors.id, productVariants.colorId))
          .where(inArray(productVariants.id, variantIds))
      : [];
    const imageRows = variantRows.length
      ? await tx
          .select({
            productId: productImages.productId,
            colorId: productImages.colorId,
            url: productImages.url,
          })
          .from(productImages)
          .where(inArray(productImages.productId, [...new Set(variantRows.map((row) => row.productId))]))
          .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder))
      : [];

    const lines = input.items.map((item) => {
      if (!("variantId" in item)) {
        return {
          productName: item.name,
          colorName: item.details,
          size: item.size,
          sku: skuFor("custom", item.name, item.size || "one"),
          productId: null,
          variantId: null,
          imageUrl: null,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
        };
      }
      const variant = variantRows.find((row) => row.variantId === item.variantId);
      if (!variant) {
        throw new OrderError("One of the products has changed or been removed. Pick it again.");
      }
      const ofProduct = imageRows.filter((image) => image.productId === variant.productId);
      const image =
        ofProduct.find((candidate) => candidate.colorId === variant.colorId) ??
        ofProduct.find((candidate) => candidate.colorId === null);
      return {
        productName: variant.productName,
        colorName: variant.colorName,
        size: variant.size,
        sku: variant.sku,
        productId: variant.productId,
        variantId: variant.variantId,
        imageUrl: image?.url ?? null,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      };
    });

    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
    const totalCents = subtotalCents + input.shippingCents - input.discountCents;
    if (totalCents < 0) throw new OrderError("The discount is more than the order comes to.");

    const email = input.email.trim().toLowerCase();
    const name = input.customerName.trim() || null;
    const [customer] = await tx
      .insert(customers)
      .values({
        email,
        name,
        phone: input.phone.trim() || null,
        defaultAddress: input.shipTo,
      })
      .onConflictDoUpdate({
        target: customers.email,
        set: {
          name: sql`coalesce(excluded.name, ${customers.name})`,
          phone: sql`coalesce(excluded.phone, ${customers.phone})`,
          defaultAddress: sql`coalesce(excluded.default_address, ${customers.defaultAddress})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: customers.id });

    const paid = input.paidWith !== null;
    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber,
        customerId: customer.id,
        email,
        status: paid ? "PAID" : "PENDING",
        subtotalCents,
        discountCents: input.discountCents,
        shippingCents: input.shippingCents,
        taxCents: 0,
        totalCents,
        paymentProvider: input.paidWith,
        paymentStatus: paid ? "PAID" : "UNPAID",
        paidAt: paid ? new Date() : null,
        shippingName: name ?? email,
        shippingAddress: input.shipTo ?? NO_ADDRESS,
        shippingMethod: input.shipTo ? null : PICKUP,
      })
      .returning({ id: orders.id });

    await tx.insert(orderItems).values(lines.map((line) => ({ orderId: order.id, ...line })));

    const note = input.note.trim();
    await tx.insert(orderEvents).values([
      { orderId: order.id, actor, type: "order.created", message: "Order added by hand" },
      ...(paid
        ? [
            {
              orderId: order.id,
              actor,
              type: "order.paid",
              message: paidMessage(input.paidWith as PaymentMethod),
            },
          ]
        : []),
      ...(note ? [{ orderId: order.id, actor, type: "order.note", message: note }] : []),
    ]);

    return { orderNumber, isNew: true };
  });
}

const paidMessage = (method: PaymentMethod) =>
  method === "No charge" ? "Marked as no charge" : `Marked as paid: ${method}`;

/** Records that an order added by hand has now been paid for. */
export async function markPaid(
  db: Database,
  orderNumber: string,
  actor: string,
  method: PaymentMethod,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)
      .for("update");
    if (!order) throw new OrderError("That order no longer exists.");
    if (order.status !== "PENDING") {
      throw new OrderError("This order has changed since the page loaded. Refresh and try again.");
    }
    await tx
      .update(orders)
      .set({ status: "PAID", paymentStatus: "PAID", paidAt: new Date(), paymentProvider: method })
      .where(eq(orders.id, order.id));
    await tx
      .insert(orderEvents)
      .values({ orderId: order.id, actor, type: "order.paid", message: paidMessage(method) });
  });
}
