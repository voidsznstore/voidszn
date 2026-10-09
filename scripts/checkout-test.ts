/**
 * Checks for checkout pricing, sales tax, call limits and the paid-order writer.
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
import { eq, like } from "drizzle-orm";
import { getDb } from "../src/db";
import { findCheckout, saveCheckout } from "../src/db/queries/checkouts";
import { recordPaidOrder } from "../src/db/queries/orders";
import { checkouts, customers, orderItems, orders, rateLimits, webhookEvents } from "../src/db/schema";
import { isFloridaZip, placeProblem } from "../src/lib/checkout/address";
import { totalsFor } from "../src/lib/checkout/discounts";
import { addressSchema, checkoutRequestSchema } from "../src/lib/checkout/request";
import { salesTaxFor } from "../src/lib/checkout/tax";
import { type Limit, isSpent, take } from "../src/lib/rate-limit";
import { sampleCatalog } from "../src/lib/catalog/sample";
import { cartLinesSchema, priceCart, shippingFor } from "../src/lib/checkout/pricing";
import { ORDER_SOURCE, TAX_CHARGE_UID, type SquareOrder, type SquarePayment } from "../src/lib/payments/square";
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

section("Sales tax at checkout");

/** An ordinary day, outside the back-to-school tax holiday. */
const october = new Date("2026-10-09T16:00:00Z");
const orlando = { state: "FL", postalCode: "32832" };

check("an order to Orlando pays 6.5% on the items and the shipping", async () => {
  const priced = await priceCart([line({ quantity: 2 })]);
  assert.ok(priced.ok);
  const totals = totalsFor(priced.cart, null);
  const tax = salesTaxFor(priced.cart, totals, orlando, october);
  assert.equal(tax.rateBps, 650);
  assert.equal(tax.taxCents, Math.round((totals.subtotalCents + totals.shippingCents) * 0.065));
  assert.equal(tax.label, "Sales tax (6.5%)");
  assert.equal(tax.receiptName, "Florida sales tax (6.5%)");
});

check("the tax is on the price after a discount", async () => {
  const priced = await priceCart([line({ quantity: 2 })]);
  assert.ok(priced.ok);
  const discount = { id: "d", code: "TEN", label: "$10 off", discountCents: 1000, freeShipping: false };
  const totals = totalsFor(priced.cart, discount);
  const tax = salesTaxFor(priced.cart, totals, orlando, october);
  assert.equal(tax.taxCents, Math.round((totals.subtotalCents - 1000 + totals.shippingCents) * 0.065));
});

check("the surtax follows the county the order is delivered to", async () => {
  const priced = await priceCart([line()]);
  assert.ok(priced.ok);
  const totals = totalsFor(priced.cart, null);
  // Miami-Dade is 1%, Hillsborough (Tampa) 1.5%, Collier (Naples) none.
  assert.equal(salesTaxFor(priced.cart, totals, { state: "FL", postalCode: "33130" }, october).rateBps, 700);
  assert.equal(salesTaxFor(priced.cart, totals, { state: "FL", postalCode: "33602" }, october).rateBps, 750);
  assert.equal(salesTaxFor(priced.cart, totals, { state: "FL", postalCode: "34102" }, october).rateBps, 600);
});

check("an order to another state pays no sales tax", async () => {
  const priced = await priceCart([line()]);
  assert.ok(priced.ok);
  const tax = salesTaxFor(priced.cart, totalsFor(priced.cart, null), { state: "NY", postalCode: "10001" }, october);
  assert.equal(tax.taxCents, 0);
  assert.equal(tax.rateBps, 0);
  assert.equal(tax.label, "Sales tax");
});

check("clothing at $100 or less is tax-free during the summer tax holiday", async () => {
  const priced = await priceCart([line()]);
  assert.ok(priced.ok);
  const totals = totalsFor(priced.cart, null);
  assert.equal(salesTaxFor(priced.cart, totals, orlando, new Date("2026-08-01T16:00:00Z")).taxCents, 0);
  assert.ok(salesTaxFor(priced.cart, totals, orlando, new Date("2026-08-21T16:00:00Z")).taxCents > 0);
});

check("a state and ZIP code that disagree about Florida are caught", () => {
  assert.ok(isFloridaZip("32832") && isFloridaZip("34997") && isFloridaZip("33130-1234"));
  assert.ok(!isFloridaZip("10001") && !isFloridaZip("34002") && !isFloridaZip("31999") && !isFloridaZip("35004"));
  assert.match(placeProblem("FL", "10001") ?? "", /isn't in Florida/);
  assert.match(placeProblem("GA", "32832") ?? "", /is in Florida/);
  assert.equal(placeProblem("FL", "32832"), null);
  assert.equal(placeProblem("NY", "10001"), null);
});

check("the address is checked before anything is charged", () => {
  const good = { name: "Casey Buyer", line1: "9 Test Ave", city: "Orlando", state: "fl", postalCode: "32801" };
  const parsed = addressSchema.safeParse(good);
  assert.ok(parsed.success);
  assert.equal(parsed.data.state, "FL");
  assert.ok(!addressSchema.safeParse({ ...good, postalCode: "3280" }).success);
  assert.ok(!addressSchema.safeParse({ ...good, state: "ZZ" }).success);
  assert.ok(!addressSchema.safeParse({ ...good, line1: "" }).success);
  assert.ok(!addressSchema.safeParse({ ...good, name: "Casey\nBuyer" }).success);
  assert.ok(!addressSchema.safeParse({ ...good, phone: "call me" }).success);
  assert.ok(addressSchema.safeParse({ ...good, phone: "(407) 555-0100" }).success);
  // A half-typed ZIP code while pricing is not an error. It just can't be taxed yet.
  const request = checkoutRequestSchema.safeParse({ lines: [line()], destination: { state: "FL", postalCode: "328" } });
  assert.ok(request.success);
  assert.equal(request.data.destination, undefined);
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

const carried = {
  shippingName: "Casey Buyer",
  phone: "(407) 555-0100",
  shippingAddress: { line1: "9 Test Ave", line2: "Apt 2", city: "Orlando", state: "FL", postalCode: "32832", country: "US" },
  taxCents: 300,
  taxRateBps: 650,
};
/** The same order as paid through a checkout that took the address itself and charged tax. */
const taxedOrder: SquareOrder = {
  ...order,
  fulfillments: [],
  service_charges: [
    { name: "Standard shipping", amount_money: { amount: 524, currency: "USD" } },
    { uid: TAX_CHARGE_UID, name: "Florida sales tax (6.5%)", amount_money: { amount: 300, currency: "USD" } },
  ],
  total_money: { amount: tee.priceCents * 2 + 524 + 300, currency: "USD" },
  total_service_charge_money: { amount: 824, currency: "USD" },
};
const taxedPayment: SquarePayment = { ...payment, amount_money: taxedOrder.total_money };

check("the address given at checkout is the one the order is saved with", () => {
  const input = orderFromSquare(event, taxedPayment, taxedOrder, carried);
  assert.ok(input);
  assert.equal(input.shippingName, "Casey Buyer");
  assert.equal(input.phone, "(407) 555-0100");
  assert.deepEqual(input.shippingAddress, carried.shippingAddress);
  assert.equal(input.attention, undefined);
});

check("sales tax is told apart from shipping", () => {
  const input = orderFromSquare(event, taxedPayment, taxedOrder, carried);
  assert.ok(input);
  assert.equal(input.taxCents, 300);
  assert.equal(input.shippingCents, 524);
  assert.equal(input.totalCents, input.subtotalCents + 524 + 300);
});

check("a payment whose tax isn't what checkout worked out is flagged", () => {
  const input = orderFromSquare(event, taxedPayment, taxedOrder, { ...carried, taxCents: 310 });
  assert.ok(input);
  assert.match(input.attention?.[0] ?? "", /sales tax/i);
});

async function limitChecks() {
  if (!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)) {
    console.log("Call limits: skipped (no DATABASE_URL)");
    return;
  }
  console.log("Call limits");
  const db = getDb();
  const limit: Limit = { name: `test-${Date.now()}`, max: 3, windowSeconds: 3600 };
  const before = await db.select().from(rateLimits);
  try {
    assert.equal(await isSpent(limit, "1.2.3.4"), false);
    assert.deepEqual([await take(limit, "1.2.3.4"), await take(limit, "1.2.3.4"), await take(limit, "1.2.3.4")], [true, true, true]);
    assert.equal(await take(limit, "1.2.3.4"), false);
    assert.equal(await isSpent(limit, "1.2.3.4"), true);
    console.log("  ok  a caller is stopped once over the limit");
    passed += 1;

    assert.equal(await take(limit, "5.6.7.8"), true);
    assert.equal(await isSpent(limit, "5.6.7.8"), false);
    console.log("  ok  one caller's count doesn't touch another's");
    passed += 1;

    const burst = await Promise.all(Array.from({ length: 10 }, () => take(limit, "9.9.9.9")));
    assert.equal(burst.filter(Boolean).length, 3);
    console.log("  ok  ten calls at the same moment let exactly the limit through");
    passed += 1;

    const rows = await db.select().from(rateLimits);
    assert.ok(rows.every((row) => /^[0-9a-f]{40}$/.test(row.key)));
    assert.ok(!JSON.stringify(rows).includes("1.2.3.4"));
    console.log("  ok  no network address is stored in the clear");
    passed += 1;
  } finally {
    // Leaves the table as it was found.
    const keep = new Set(before.map((row) => `${row.key}|${row.windowStart.toISOString()}`));
    for (const row of await db.select().from(rateLimits)) {
      if (!keep.has(`${row.key}|${row.windowStart.toISOString()}`)) await db.delete(rateLimits).where(eq(rateLimits.key, row.key));
    }
  }

  await db.delete(checkouts).where(like(checkouts.paymentOrderRef, "ORDERcheckouttest%"));
  try {
    await saveCheckout(db, { paymentOrderRef: "ORDERcheckouttest1", ...carried });
    assert.deepEqual(await findCheckout(db, "ORDERcheckouttest1"), carried);
    assert.equal(await findCheckout(db, "ORDERcheckouttest-none"), null);
    await assert.rejects(saveCheckout(db, { paymentOrderRef: "ORDERcheckouttest1", ...carried }));
    console.log("  ok  a checkout's address is kept for its payment, once");
    passed += 1;
  } finally {
    await db.delete(checkouts).where(like(checkouts.paymentOrderRef, "ORDERcheckouttest%"));
  }
}

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
  await limitChecks();
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
