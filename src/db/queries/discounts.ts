import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import { discountCodes, discountRedemptions, orders } from "../schema";

type Executor = Pick<Database, "update">;

export type DiscountCode = typeof discountCodes.$inferSelect;

/** A code as typed, whatever its case. Null when there is no such code. */
export async function findDiscountByCode(db: Database, code: string): Promise<DiscountCode | null> {
  const [row] = await db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.code, code.trim().toUpperCase()))
    .limit(1);
  return row ?? null;
}

export async function findDiscountById(db: Database, id: string): Promise<DiscountCode | null> {
  const [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id)).limit(1);
  return row ?? null;
}

/** How many paid orders from this address have used the code. */
export async function countRedemptions(db: Database, discountCodeId: string, email: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(discountRedemptions)
    .where(
      and(
        eq(discountRedemptions.discountCodeId, discountCodeId),
        eq(discountRedemptions.email, email.trim().toLowerCase()),
      ),
    );
  return row?.value ?? 0;
}

/** Whether this address has an order already. A cancelled order doesn't count. */
export async function hasOrdered(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.email, email.trim().toLowerCase()), sql`${orders.status}::text <> 'CANCELLED'`))
    .limit(1);
  return row !== undefined;
}

/**
 * Claims one use of a discount code.
 *
 * The check and the increment happen in a single UPDATE, so two checkouts racing
 * for the last use cannot both win. Returns true if the use was claimed.
 * Call it inside the same transaction that marks the order as paid.
 */
export async function claimDiscountUse(db: Executor, discountCodeId: string): Promise<boolean> {
  const claimed = await db
    .update(discountCodes)
    .set({ usedCount: sql`${discountCodes.usedCount} + 1` })
    .where(
      and(
        eq(discountCodes.id, discountCodeId),
        eq(discountCodes.isActive, true),
        or(isNull(discountCodes.maxUses), lt(discountCodes.usedCount, discountCodes.maxUses)),
        or(isNull(discountCodes.startsAt), sql`${discountCodes.startsAt} <= now()`),
        or(isNull(discountCodes.expiresAt), sql`${discountCodes.expiresAt} > now()`),
      ),
    )
    .returning({ id: discountCodes.id });

  return claimed.length === 1;
}
