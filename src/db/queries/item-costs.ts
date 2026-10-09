import { sql } from "drizzle-orm";
import type { Database } from "../index";

/**
 * Copies each item's cost from the catalog onto the order's lines, for lines
 * that don't have one yet. Run when an order is saved, and again when a
 * product's cost is filled in, so older orders pick it up.
 */
export async function fillItemCosts(db: Database, where: { orderId: string } | { productId: string }): Promise<void> {
  const scope =
    "orderId" in where
      ? sql`order_items.order_id = ${where.orderId}`
      : sql`product_variants.product_id = ${where.productId}`;
  await db.execute(sql`
    UPDATE order_items
    SET unit_cost_cents = product_variants.cost_cents
    FROM product_variants
    WHERE order_items.variant_id = product_variants.id
      AND order_items.unit_cost_cents IS NULL
      AND product_variants.cost_cents IS NOT NULL
      AND ${scope}
  `);
}
