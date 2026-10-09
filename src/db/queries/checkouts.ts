import { eq, lt } from "drizzle-orm";
import type { Database } from "../index";
import { type Address, checkouts } from "../schema";

/**
 * Delivery details for checkouts that have gone to the payment page. See the
 * `checkouts` table: the address waits here until the payment comes back.
 */

export type CarriedCheckout = {
  shippingName: string;
  phone: string | null;
  shippingAddress: Address;
  taxCents: number;
  taxRateBps: number;
};

/** How long an unpaid checkout's address is kept. A payment page is rarely paid after this. */
const KEEP_DAYS = 60;

export async function saveCheckout(
  db: Database,
  input: CarriedCheckout & { paymentOrderRef: string },
): Promise<void> {
  await db.insert(checkouts).values(input);
}

/** The delivery details taken for this payment, or null if there are none. */
export async function findCheckout(db: Database, paymentOrderRef: string): Promise<CarriedCheckout | null> {
  const [row] = await db
    .select({
      shippingName: checkouts.shippingName,
      phone: checkouts.phone,
      shippingAddress: checkouts.shippingAddress,
      taxCents: checkouts.taxCents,
      taxRateBps: checkouts.taxRateBps,
    })
    .from(checkouts)
    .where(eq(checkouts.paymentOrderRef, paymentOrderRef))
    .limit(1);
  return row ?? null;
}

/** Forgets the addresses of checkouts that are too old to be paid for now. Run by the timed job. */
export async function clearOldCheckouts(db: Database): Promise<void> {
  await db.delete(checkouts).where(lt(checkouts.createdAt, new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)));
}
