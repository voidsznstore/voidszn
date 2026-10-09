import "server-only";
import { getDb } from "@/db";
import { ordersAwaitingFee, recordProcessingFee } from "@/db/queries/accounting";
import { getPayment, isSquareConfigured } from "./square";

/**
 * Square works out its fee a few minutes after a payment completes. This asks
 * for it on recent orders that don't have it yet, so the books use the real fee
 * instead of the usual rate. Returns how many were filled in.
 */
export async function syncProcessingFees(limit = 15): Promise<number> {
  if (!isSquareConfigured()) return 0;
  const db = getDb();
  const waiting = await ordersAwaitingFee(db, limit);
  let filled = 0;
  for (const order of waiting) {
    if (!order.paymentRef) continue;
    try {
      const payment = await getPayment(order.paymentRef);
      const fees = payment?.processing_fee ?? [];
      if (fees.length === 0) continue;
      const total = fees.reduce((sum, fee) => sum + (fee.amount_money?.amount ?? 0), 0);
      await recordProcessingFee(db, order.id, Math.max(0, total));
      filled += 1;
    } catch (error) {
      console.error("[fees] Could not read the fee for a payment", error);
    }
  }
  return filled;
}
