/**
 * Database smoke test. Run against a scratch database, never production:
 *   DATABASE_URL=postgresql://... npm run db:smoke
 * It writes rows inside one transaction and rolls everything back at the end.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { claimDiscountUse } from "../src/db/queries/discounts";
import {
  customers,
  discountCodes,
  orderItems,
  orders,
  productColors,
  productVariants,
  products,
  webhookEvents,
} from "../src/db/schema";

class Rollback extends Error {}

async function expectReject(label: string, run: () => Promise<unknown>) {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  assert.ok(rejected, `${label}: expected the database to reject this`);
  console.log(`ok  ${label}`);
}

async function main() {
  const db = getDb();
  const tag = `smoke-${Date.now()}`;

  // 1. Racing checkouts cannot both claim the last use of a code.
  const [code] = await db
    .insert(discountCodes)
    .values({ code: tag.toUpperCase(), type: "PERCENTAGE", value: 10, maxUses: 1 })
    .returning();
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimDiscountUse(db, code.id)),
    );
    assert.equal(results.filter(Boolean).length, 1, "exactly one claim should win");
    console.log("ok  discount race: 8 parallel claims, 1 winner");

    await expectReject("discount usage cannot exceed its limit", () =>
      db.update(discountCodes).set({ usedCount: 5 }).where(eq(discountCodes.id, code.id)),
    );
  } finally {
    await db.delete(discountCodes).where(eq(discountCodes.id, code.id));
  }

  // 2. Catalog, order and constraint checks, all rolled back.
  try {
    await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({ name: "Smoke Tee", slug: tag, priceCents: 3200 })
        .returning();
      const [color] = await tx
        .insert(productColors)
        .values({ productId: product.id, name: "Black", hex: "#111111" })
        .returning();
      const [variant] = await tx
        .insert(productVariants)
        .values({
          productId: product.id,
          colorId: color.id,
          size: "L",
          sku: `${tag}-BLK-L`,
          priceCents: 3200,
          costCents: 1100,
        })
        .returning();
      console.log("ok  product, color and variant insert");

      await tx.execute("SAVEPOINT s1");
      await expectReject("duplicate product + color + size", () =>
        tx.insert(productVariants).values({
          productId: product.id,
          colorId: color.id,
          size: "L",
          sku: `${tag}-BLK-L-2`,
          priceCents: 3200,
        }),
      );
      await tx.execute("ROLLBACK TO SAVEPOINT s1");

      const [customer] = await tx
        .insert(customers)
        .values({ email: `${tag}@example.com`, name: "Smoke Test" })
        .returning();
      const address = {
        line1: "1 Test St",
        city: "Orlando",
        state: "FL",
        postalCode: "32801",
        country: "US",
      };
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber: tag,
          customerId: customer.id,
          email: customer.email,
          subtotalCents: 3200,
          totalCents: 3200,
          shippingName: "Smoke Test",
          shippingAddress: address,
          paymentRef: `pay_${tag}`,
        })
        .returning();
      assert.equal(order.status, "PENDING");
      assert.equal(order.fulfillmentStatus, "UNSUBMITTED");
      await tx.insert(orderItems).values({
        orderId: order.id,
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        colorName: color.name,
        size: variant.size,
        sku: variant.sku,
        unitPriceCents: variant.priceCents,
        unitCostCents: variant.costCents,
        quantity: 1,
      });
      console.log("ok  customer, order and line item insert");

      await tx.execute("SAVEPOINT s2");
      await expectReject("one payment cannot pay two orders", () =>
        tx.insert(orders).values({
          orderNumber: `${tag}-b`,
          customerId: customer.id,
          email: customer.email,
          subtotalCents: 3200,
          totalCents: 3200,
          shippingName: "Smoke Test",
          shippingAddress: address,
          paymentRef: `pay_${tag}`,
        }),
      );
      await tx.execute("ROLLBACK TO SAVEPOINT s2");

      await tx.execute("SAVEPOINT s3");
      await expectReject("zero quantity line item", () =>
        tx.insert(orderItems).values({
          orderId: order.id,
          productName: "x",
          colorName: "x",
          size: "x",
          sku: "x",
          unitPriceCents: 1,
          quantity: 0,
        }),
      );
      await tx.execute("ROLLBACK TO SAVEPOINT s3");

      await tx.insert(webhookEvents).values({ provider: "test", eventId: tag, type: "t" });
      await tx.execute("SAVEPOINT s4");
      await expectReject("replayed webhook event", () =>
        tx.insert(webhookEvents).values({ provider: "test", eventId: tag, type: "t" }),
      );
      await tx.execute("ROLLBACK TO SAVEPOINT s4");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  const leftovers = await db.select().from(products).where(eq(products.slug, tag));
  assert.equal(leftovers.length, 0, "transaction should have rolled back");
  console.log("ok  rollback left nothing behind");
  console.log("\nAll database checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
