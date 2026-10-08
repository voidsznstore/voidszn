import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import { discountCodes } from "../schema";

type Executor = Pick<Database, "update">;

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
