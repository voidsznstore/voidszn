/**
 * Checks for checkout pricing and the paid-order writer.
 *
 *   npm run test:checkout
 *
 * The pricing checks need nothing. The order checks run only when DATABASE_URL
 * points at a scratch database (never production): they write inside a
 * transaction per case and delete what they wrote.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "../src/db";
import { recordPaidOrder } from "../src/db/queries/orders";
import { customers, orderItems, orders, webhookEvents } from "../src/db/schema";
import { getProducts } from "../src/lib/catalog";
import {
  cartLinesSchema,
  decodeCart,
  encodeCart,
  priceCart,
  shippingFor,
} from "../src/lib/checkout/pricing";
import { orderFromSession, paymentRefFor } from "../src/lib/payments/stripe-orders";
import { siteConfig } from "../src/lib/site-config";

let passed = 0;
function check(label: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ok  ${label}`);
}

const [tee, otherTee] = getProducts();
const line = (overrides: Partial<{ slug: string; color: string; size: string; quantity: number }> = {}) => ({
  slug: tee.slug,
  color: tee.colors[0].name,
  size: tee.sizes[0],
  quantity: 1,
  ...overrides,
});

console.log("Pricing");

check("prices come from the catalog", () => {
  const result = priceCart([line({ quantity: 2 })]);
  assert.ok(result.ok);
  assert.equal(result.cart.subtotalCents, tee.priceCents * 2);
  assert.equal(result.cart.lines[0].unitPriceCents, tee.priceCents);
});

check("the same item sent twice is merged", () => {
  const result = priceCart([line(), line({ quantity: 3 })]);
  assert.ok(result.ok);
  assert.equal(result.cart.lines.length, 1);
  assert.equal(result.cart.lines[0].quantity, 4);
});

check("merging can't be used to pass the quantity limit", () => {
  const result = priceCart([line({ quantity: 10 }), line({ quantity: 10 })]);
  assert.equal(result.ok, false);
});

check("unknown product, color and size are refused", () => {
  assert.equal(priceCart([line({ slug: "not-a-product" })]).ok, false);
  assert.equal(priceCart([line({ color: "Neon" })]).ok, false);
  assert.equal(priceCart([line({ size: "6XL" })]).ok, false);
});

check("the request shape is strict", () => {
  assert.equal(cartLinesSchema.safeParse([]).success, false);
  assert.equal(cartLinesSchema.safeParse([line({ quantity: 0 })]).success, false);
  assert.equal(cartLinesSchema.safeParse([line({ quantity: 1.5 })]).success, false);
  assert.equal(cartLinesSchema.safeParse([line({ quantity: 11 })]).success, false);
  assert.equal(cartLinesSchema.safeParse([{ ...line(), quantity: "2" }]).success, false);
  assert.equal(cartLinesSchema.safeParse(Array(21).fill(line())).success, false);
  assert.equal(cartLinesSchema.safeParse("cart").success, false);
});

check("shipping: one tee", () => {
  assert.equal(shippingFor([{ typeSlug: "t-shirts", quantity: 1 }]), 449);
});

check("shipping: three tees", () => {
  assert.equal(shippingFor([{ typeSlug: "t-shirts", quantity: 3 }]), 449 + 75 * 2);
});

check("shipping: a hoodie and two tees charges the hoodie as the first item", () => {
  assert.equal(
    shippingFor([
      { typeSlug: "t-shirts", quantity: 2 },
      { typeSlug: "hoodies", quantity: 1 },
    ]),
    649 + 75 * 2,
  );
});

check("shipping: an unknown product type uses the fallback rate", () => {
  assert.equal(shippingFor([{ typeSlug: null, quantity: 1 }]), siteConfig.shipping.fallbackRate.first);
  assert.equal(shippingFor([]), 0);
});

check("the cart survives the trip through session metadata", () => {
  const priced = priceCart([line({ quantity: 2 }), line({ slug: otherTee.slug, color: otherTee.colors[0].name, size: otherTee.sizes[1] })]);
  assert.ok(priced.ok);
  const metadata = encodeCart(priced.cart.lines);
  for (const value of Object.values(metadata)) assert.ok(value.length <= 500);
  const decoded = decodeCart(metadata);
  assert.deepEqual(
    decoded,
    priced.cart.lines.map(({ slug, color, size, quantity, unitPriceCents }) => ({
      slug,
      color,
      size,
      quantity,
      unitPriceCents,
    })),
  );
});

check("the largest possible cart fits in metadata", () => {
  const big = Array.from({ length: 20 }, (_, index) => ({
    slug: `a-product-with-quite-a-long-name-number-${index}`,
    color: "Heather Charcoal",
    size: "2XL",
    quantity: 10,
    unitPriceCents: 12345,
  }));
  const metadata = encodeCart(big);
  // Stripe allows 50 keys of up to 500 characters each.
  assert.ok(Object.keys(metadata).length <= 50);
  assert.deepEqual(decodeCart(metadata), big);
});

check("damaged or missing metadata is refused, not guessed at", () => {
  assert.equal(decodeCart(null), null);
  assert.equal(decodeCart({}), null);
  assert.equal(decodeCart({ cart_0: "[[" }), null);
  assert.equal(decodeCart({ cart_0: '[["a","b","c",-1,100]]' }), null);
});

console.log("Reading a checkout session");

const metadata = encodeCart([
  { slug: tee.slug, color: tee.colors[0].name, size: "M", quantity: 2, unitPriceCents: tee.priceCents },
]);
const session = {
  id: "cs_test_checkouttest",
  payment_intent: "pi_checkouttest",
  payment_status: "paid",
  currency: "usd",
  amount_subtotal: tee.priceCents * 2,
  amount_total: tee.priceCents * 2 + 524 + 300,
  total_details: { amount_discount: 0, amount_shipping: 524, amount_tax: 300 },
  customer_details: {
    email: "Buyer@Example.com",
    name: "Test Buyer",
    phone: null,
    address: null,
  },
  collected_information: {
    shipping_details: {
      name: "Test Buyer",
      address: {
        line1: "1 Test St",
        line2: null,
        city: "Austin",
        state: "TX",
        postal_code: "78701",
        country: "US",
      },
    },
  },
  metadata,
} as unknown as Stripe.Checkout.Session;
const event = { id: "evt_checkouttest_1", type: "checkout.session.completed" } as const;

check("a paid session becomes an order", () => {
  const order = orderFromSession(event, session);
  assert.ok(order);
  assert.equal(order.paymentRef, "pi_checkouttest");
  assert.equal(order.totalCents, session.amount_total);
  assert.equal(order.shippingCents, 524);
  assert.equal(order.taxCents, 300);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productName, tee.name);
  assert.equal(order.shippingAddress.postalCode, "78701");
});

check("a session without a cart, email or address is not an order", () => {
  assert.equal(orderFromSession(event, { ...session, metadata: {} }), null);
  assert.equal(
    orderFromSession(event, { ...session, customer_details: null } as Stripe.Checkout.Session),
    null,
  );
  assert.equal(
    orderFromSession(event, { ...session, collected_information: null } as Stripe.Checkout.Session),
    null,
  );
});

check("a free order is referenced by its session", () => {
  assert.equal(paymentRefFor({ ...session, payment_intent: null } as Stripe.Checkout.Session), session.id);
});

async function orderChecks() {
  if (!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)) {
    console.log("Saving orders: skipped (no DATABASE_URL)");
    return;
  }
  console.log("Saving orders");
  const db = getDb();
  const input = orderFromSession(event, session);
  assert.ok(input);

  const cleanup = async () => {
    await db.delete(orders).where(eq(orders.paymentRef, input.paymentRef));
    await db.delete(customers).where(eq(customers.email, "buyer@example.com"));
    await db.delete(webhookEvents).where(eq(webhookEvents.provider, "stripe-test"));
  };
  const withEvent = (id: string) => ({ ...input, event: { ...input.event, provider: "stripe-test", id } });
  await cleanup();

  try {
    const first = await recordPaidOrder(db, withEvent("evt_a"));
    assert.equal(first.status, "created");
    console.log("  ok  the first event creates the order");
    passed += 1;

    assert.deepEqual(await recordPaidOrder(db, withEvent("evt_a")), { status: "duplicate_event" });
    console.log("  ok  the same event again changes nothing");
    passed += 1;

    assert.deepEqual(await recordPaidOrder(db, withEvent("evt_b")), { status: "order_exists" });
    console.log("  ok  a second event for the same payment changes nothing");
    passed += 1;

    const results = await Promise.all(
      ["evt_c", "evt_d", "evt_e", "evt_f"].map((id) =>
        recordPaidOrder(db, { ...withEvent(id), paymentRef: "pi_checkouttest_race" }),
      ),
    );
    assert.equal(results.filter((result) => result.status === "created").length, 1);
    await db.delete(orders).where(eq(orders.paymentRef, "pi_checkouttest_race"));
    console.log("  ok  four events arriving at once create one order");
    passed += 1;

    const saved = await db.select().from(orders).where(eq(orders.paymentRef, input.paymentRef));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].status, "PAID");
    assert.equal(saved[0].email, "buyer@example.com");
    assert.equal(saved[0].totalCents, input.totalCents);
    assert.match(saved[0].orderNumber, /^VS-[2-9A-HJ-NP-Z]{8}$/);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, saved[0].id));
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].unitPriceCents, tee.priceCents);
    console.log("  ok  the saved order matches what was paid");
    passed += 1;
  } finally {
    await cleanup();
  }
}

orderChecks()
  .then(() => {
    console.log(`\n${passed} checks passed`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
