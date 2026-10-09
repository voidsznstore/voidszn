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
import { getDb } from "../src/db";
import { recordPaidOrder } from "../src/db/queries/orders";
import { customers, orderItems, orders, webhookEvents } from "../src/db/schema";
import { sampleCatalog } from "../src/lib/catalog/sample";
import { cartLinesSchema, priceCart, shippingFor } from "../src/lib/checkout/pricing";
import { ORDER_SOURCE, type SquareOrder, type SquarePayment } from "../src/lib/payments/square";
import { orderFromSquare } from "../src/lib/payments/square-orders";
import { siteConfig } from "../src/lib/site-config";

let passed = 0;
const checks: { label: string; run: () => void | Promise<void> }[] = [];
/** Queues a check. They run in order once the file has been read. */
function check(label: string, run: () => void | Promise<void>) {
  checks.push({ label, run });
}
function section(title: string) {
  checks.push({ label: `§${title}`, run: () => {} });
}

// The sample products are also what the test database is seeded with.
const [tee] = sampleCatalog().products;
const line = (overrides: Partial<{ slug: string; color: string; size: string; quantity: number }> = {}) => ({
  slug: tee.slug,
  color: tee.colors[0].name,
  size: tee.sizes[0].size,
  quantity: 1,
  ...overrides,
});

section("Pricing");

check("prices come from the catalog", async () => {
  const result = await priceCart([line({ quantity: 2 })]);
  assert.ok(result.ok);
  assert.equal(result.cart.subtotalCents, tee.priceCents * 2);
  assert.equal(result.cart.lines[0].unitPriceCents, tee.priceCents);
});

check("the same item sent twice is merged", async () => {
  const result = await priceCart([line(), line({ quantity: 3 })]);
  assert.ok(result.ok);
  assert.equal(result.cart.lines.length, 1);
  assert.equal(result.cart.lines[0].quantity, 4);
});

check("merging can't be used to pass the quantity limit", async () => {
  const result = await priceCart([line({ quantity: 10 }), line({ quantity: 10 })]);
  assert.equal(result.ok, false);
});

check("unknown product, color and size are refused", async () => {
  assert.equal((await priceCart([line({ slug: "not-a-product" })])).ok, false);
  assert.equal((await priceCart([line({ color: "Neon" })])).ok, false);
  assert.equal((await priceCart([line({ size: "6XL" })])).ok, false);
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

section("Reading a Square payment");

const order: SquareOrder = {
  id: "ORDERcheckouttest1",
  location_id: "LOC1",
  metadata: { source: ORDER_SOURCE },
  line_items: [
    {
      name: tee.name,
      quantity: "2",
      base_price_money: { amount: tee.priceCents, currency: "USD" },
      metadata: { slug: tee.slug, color: tee.colors[0].name, size: "M" },
    },
  ],
  fulfillments: [
    {
      type: "SHIPMENT",
      shipment_details: {
        recipient: {
          display_name: "Test Buyer",
          email_address: "Buyer@Example.com",
          phone_number: "+14075550100",
          address: {
            address_line_1: "1 Test St",
            locality: "Orlando",
            administrative_district_level_1: "FL",
            postal_code: "32801",
            country: "US",
          },
        },
      },
    },
  ],
  tenders: [{ id: "PAYcheckouttest1", payment_id: "PAYcheckouttest1" }],
  total_money: { amount: tee.priceCents * 2 + 524, currency: "USD" },
  total_tax_money: { amount: 0, currency: "USD" },
  total_discount_money: { amount: 0, currency: "USD" },
  total_service_charge_money: { amount: 524, currency: "USD" },
};
const payment: SquarePayment = {
  id: "PAYcheckouttest1",
  status: "COMPLETED",
  order_id: order.id,
  amount_money: order.total_money,
  buyer_email_address: "Buyer@Example.com",
};
const event = { provider: "square", id: "evt_checkouttest_1", type: "payment.updated" };

check("a completed payment becomes an order", () => {
  const input = orderFromSquare(event, payment, order);
  assert.ok(input);
  assert.equal(input.paymentRef, "PAYcheckouttest1");
  assert.equal(input.totalCents, tee.priceCents * 2 + 524);
  assert.equal(input.subtotalCents, tee.priceCents * 2);
  assert.equal(input.shippingCents, 524);
  assert.equal(input.items.length, 1);
  assert.equal(input.items[0].quantity, 2);
  assert.equal(input.shippingName, "Test Buyer");
  assert.equal(input.shippingAddress.postalCode, "32801");
});

check("a payment taken elsewhere on the Square account is ignored", () => {
  assert.equal(orderFromSquare(event, payment, { ...order, metadata: {} }), null);
  assert.equal(orderFromSquare(event, payment, { ...order, metadata: { source: "pos" } }), null);
});

check("an unfinished, mismatched or part payment is not an order", () => {
  assert.equal(orderFromSquare(event, { ...payment, status: "APPROVED" }, order), null);
  assert.equal(orderFromSquare(event, { ...payment, order_id: "OTHER" }, order), null);
  assert.equal(
    orderFromSquare(event, { ...payment, amount_money: { amount: 100, currency: "USD" } }, order),
    null,
  );
});

check("an order without an email or readable items is refused", () => {
  assert.equal(
    orderFromSquare(event, { ...payment, buyer_email_address: undefined }, { ...order, fulfillments: [] }),
    null,
  );
  assert.equal(
    orderFromSquare(event, payment, { ...order, line_items: [{ ...order.line_items![0], metadata: {} }] }),
    null,
  );
  assert.equal(
    orderFromSquare(event, payment, { ...order, line_items: [{ ...order.line_items![0], quantity: "1.5" }] }),
    null,
  );
});

check("a paid order with no address is still saved, and flagged", () => {
  const input = orderFromSquare(event, payment, { ...order, fulfillments: [{ type: "SHIPMENT" }] });
  assert.ok(input);
  assert.equal(input.shippingAddress.line1, "");
  assert.equal(input.attention?.length, 1);
  assert.equal(orderFromSquare(event, payment, order)?.attention, undefined);
});

async function orderChecks() {
  if (!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)) {
    console.log("Saving orders: skipped (no DATABASE_URL)");
    return;
  }
  console.log("Saving orders");
  const db = getDb();
  const input = orderFromSquare(event, payment, order);
  assert.ok(input);

  const cleanup = async () => {
    await db.delete(orders).where(eq(orders.paymentRef, input.paymentRef));
    await db.delete(customers).where(eq(customers.email, "buyer@example.com"));
    await db.delete(webhookEvents).where(eq(webhookEvents.provider, "square-test"));
  };
  const withEvent = (id: string) => ({ ...input, event: { ...input.event, provider: "square-test", id } });
  await cleanup();

  try {
    const first = await recordPaidOrder(db, withEvent("evt_a"));
    assert.equal(first.status, "created");
    console.log("  ok  the first event creates the order");
    passed += 1;

    assert.deepEqual(await recordPaidOrder(db, withEvent("evt_a")), { status: "order_exists" });
    console.log("  ok  the same event again changes nothing");
    passed += 1;

    assert.deepEqual(await recordPaidOrder(db, withEvent("evt_b")), { status: "order_exists" });
    console.log("  ok  a second event for the same payment changes nothing");
    passed += 1;

    const results = await Promise.all(
      ["evt_c", "evt_d", "evt_e", "evt_f"].map((id) =>
        recordPaidOrder(db, { ...withEvent(id), paymentRef: "PAYcheckouttest_race" }),
      ),
    );
    assert.equal(results.filter((result) => result.status === "created").length, 1);
    await db.delete(orders).where(eq(orders.paymentRef, "PAYcheckouttest_race"));
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

async function main() {
  for (const { label, run } of checks) {
    if (label.startsWith("§")) {
      console.log(label.slice(1));
      continue;
    }
    await run();
    passed += 1;
    console.log(`  ok  ${label}`);
  }
  await orderChecks();
}

main()
  .then(() => {
    console.log(`\n${passed} checks passed`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
