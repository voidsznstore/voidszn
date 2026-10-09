import "server-only";
import type { Database } from "@/db";
import { getProducts } from "@/lib/catalog";
import { primaryImage } from "@/lib/catalog/shape";
import { siteConfig } from "@/lib/site-config";
import { getAutomation, usableEmailDiscount } from "./automation";
import {
  type RenderedEmail,
  cartReminderEmail,
  orderCancelledEmail,
  orderDeliveredEmail,
  orderPlacedEmail,
  orderRefundedEmail,
  orderShippedEmail,
} from "./templates";

/**
 * The emails the store sends by itself, and a filled-in example of each for the
 * admin to look at. Examples use the store's own products and current settings,
 * so what is shown is what a customer would get.
 */

export const AUTOMATIC_EMAILS = [
  { key: "order-placed", group: "orders", name: "Order confirmed", when: "Goes out the moment an order is paid." },
  { key: "order-shipped", group: "orders", name: "Shipped", when: "When you mark an order as shipped, with the tracking details." },
  { key: "order-delivered", group: "orders", name: "Delivered", when: "When you mark an order as delivered. Can carry a thank-you code." },
  { key: "order-refunded", group: "orders", name: "Refund sent", when: "When you refund all or part of an order." },
  { key: "order-cancelled", group: "orders", name: "Order cancelled", when: "When you cancel an order." },
  { key: "cart-1", group: "cart", name: "First reminder", when: "A short nudge with their cart and one button." },
  { key: "cart-2", group: "cart", name: "Second reminder", when: "Answers the usual worries: how it's made, and what if it's wrong." },
  { key: "cart-3", group: "cart", name: "Last reminder", when: "A last call before the cart is cleared." },
] as const;

export type AutomaticEmailKey = (typeof AUTOMATIC_EMAILS)[number]["key"];

export const isAutomaticEmailKey = (value: string): value is AutomaticEmailKey =>
  AUTOMATIC_EMAILS.some((email) => email.key === value);

const ORDER_NUMBER = "VS-EXAMPLE1";

export async function sampleEmail(db: Database, key: AutomaticEmailKey): Promise<RenderedEmail> {
  const automation = await getAutomation(db);

  // Two real products, so the example looks like a real order.
  const products = (await getProducts()).slice(0, 2);
  const lines = products.map((product, index) => ({
    name: product.name,
    color: product.colors[0]?.name ?? "",
    size: product.sizes[Math.min(1, product.sizes.length - 1)]?.size ?? "",
    quantity: index === 0 ? 1 : 2,
    unitPriceCents: product.priceCents,
    imageUrl: primaryImage(product)?.url ?? null,
  }));
  if (lines.length === 0) {
    lines.push({ name: "Example Tee", color: "Black", size: "M", quantity: 1, unitPriceCents: 3200, imageUrl: null });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const shipping = 524;
  const customerName = "Alex Rivera";

  switch (key) {
    case "order-placed":
      return orderPlacedEmail({
        orderNumber: ORDER_NUMBER,
        customerName,
        items: lines.map((line) => ({
          productName: line.name,
          colorName: line.color,
          size: line.size,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          imageUrl: line.imageUrl,
        })),
        discountCents: 0,
        shippingCents: shipping,
        taxCents: 0,
        totalCents: subtotal + shipping,
        shippingName: customerName,
        shippingAddress: { line1: "123 Example Street", city: "Orlando", state: "FL", postalCode: "32801", country: "US" },
      });
    case "order-shipped":
      return orderShippedEmail({
        orderNumber: ORDER_NUMBER,
        customerName,
        carrier: "USPS",
        trackingNumber: "9400 1000 0000 0000 0000 00",
        trackingUrl: siteConfig.url,
      });
    case "order-delivered":
      return orderDeliveredEmail({
        orderNumber: ORDER_NUMBER,
        customerName,
        discount: await usableEmailDiscount(db, automation.delivered.discountCodeId),
      });
    case "order-refunded":
      return orderRefundedEmail({
        orderNumber: ORDER_NUMBER,
        customerName,
        amountCents: subtotal + shipping,
        isFullRefund: true,
      });
    case "order-cancelled":
      return orderCancelledEmail({ orderNumber: ORDER_NUMBER, customerName, wasPaid: true });
    case "cart-1":
    case "cart-2":
    case "cart-3": {
      const step = Number(key.slice(-1)) as 1 | 2 | 3;
      return cartReminderEmail({
        step,
        items: lines,
        restoreUrl: `${siteConfig.url}/checkout`,
        discount: await usableEmailDiscount(db, automation.cart.steps[step - 1].discountCodeId),
        unsubscribeUrl: `${siteConfig.url}/unsubscribe/test`,
      });
    }
  }
}
