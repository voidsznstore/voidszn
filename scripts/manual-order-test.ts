/**
 * Checks that sending the "Add order" form twice makes one order.
 * Writes test orders, so run it against a scratch database, never production:
 *   DATABASE_URL=postgresql://... npm run test:manual-order
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { type ManualOrderInput, createManualOrder } from "../src/db/queries/admin-manual-orders";
import { customers, orders } from "../src/db/schema";

async function main() {
  const db = getDb();
  const email = `dedupe-${randomUUID().slice(0, 8)}@example.com`;
  const input: ManualOrderInput = {
    token: randomUUID(),
    email,
    customerName: "Dedupe Test",
    phone: "",
    shipTo: null,
    items: [{ name: "Test item", details: "", size: "", quantity: 2, unitPriceCents: 1500 }],
    shippingCents: 0,
    discountCents: 0,
    paidWith: "Cash",
    note: "",
  };

  // Two at the same moment, then one more later: a double click and a retry.
  const [first, second] = await Promise.all([
    createManualOrder(db, "test", input),
    createManualOrder(db, "test", input),
  ]);
  const third = await createManualOrder(db, "test", input);

  assert.equal(first.orderNumber, second.orderNumber);
  assert.equal(first.orderNumber, third.orderNumber);
  assert.equal([first, second, third].filter((result) => result.isNew).length, 1);

  const saved = await db.select().from(orders).where(eq(orders.email, email));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].totalCents, 3000);
  console.log("  ok  the same form sent three times makes one order");

  // A new form is a new order, even with the same details.
  const other = await createManualOrder(db, "test", { ...input, token: randomUUID() });
  assert.notEqual(other.orderNumber, first.orderNumber);
  assert.equal(other.isNew, true);
  console.log("  ok  a new form makes a new order");

  // A discount bigger than the order is refused and nothing is left behind.
  const bad = { ...input, token: randomUUID(), email: `bad-${email}`, discountCents: 99_999 };
  await assert.rejects(createManualOrder(db, "test", bad), /discount/);
  assert.equal((await db.select().from(orders).where(eq(orders.email, bad.email))).length, 0);
  assert.equal((await db.select().from(customers).where(eq(customers.email, bad.email))).length, 0);
  const again = await createManualOrder(db, "test", { ...bad, discountCents: 0 });
  assert.equal(again.isNew, true);
  console.log("  ok  a refused order saves nothing, and the corrected form then goes through");

  console.log("\n3 checks passed");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
