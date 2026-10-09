import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../index";
import { expenses, orderEvents, orderItems, orders, recurringCosts } from "../schema";
import { type ExpenseCategory, isExpenseCategory } from "@/lib/accounting/categories";
import type { Day } from "@/lib/accounting/days";
import {
  type Assumptions,
  DEFAULT_ASSUMPTIONS,
  type ExpenseFact,
  type Facts,
  type OrderFact,
  type RecurringFact,
  type RefundFact,
} from "@/lib/accounting/ledger";
import { FL_HOLIDAY } from "@/lib/accounting/tax";
import { getSetting, setSetting } from "./settings";
import { PICKUP } from "./admin-manual-orders";

/** A problem the person using the admin can fix. Shown to them as written. */
export class AccountingError extends Error {}

const ASSUMPTIONS_SETTING = "accounting.assumptions";

const whole = (value: unknown, fallback: number, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : fallback;

export async function getAssumptions(db: Database): Promise<Assumptions> {
  const saved = await getSetting(db, ASSUMPTIONS_SETTING);
  if (!saved) return DEFAULT_ASSUMPTIONS;
  try {
    const value = JSON.parse(saved) as Partial<Assumptions>;
    return {
      feeBps: whole(value.feeBps, DEFAULT_ASSUMPTIONS.feeBps, 2000),
      feeFixedCents: whole(value.feeFixedCents, DEFAULT_ASSUMPTIONS.feeFixedCents, 1000),
      shipCostCents: whole(value.shipCostCents, DEFAULT_ASSUMPTIONS.shipCostCents, 100_000),
    };
  } catch {
    return DEFAULT_ASSUMPTIONS;
  }
}

export const saveAssumptions = (db: Database, value: Assumptions) =>
  setSetting(db, ASSUMPTIONS_SETTING, JSON.stringify(value));

/**
 * Everything the books are built from. Only orders that were paid for count.
 * An order added by hand and then cancelled is left out altogether: its money
 * didn't come through the site, so the site can't have refunded it, and the
 * books take it that the customer got it back.
 */
export async function loadFacts(db: Database): Promise<Facts> {
  // One after another, not all at once: this also runs inside a transaction,
  // where a single connection can only do one thing at a time.
  const orderRows = await db
    .select({
      orderNumber: orders.orderNumber,
      paidAt: orders.paidAt,
      provider: orders.paymentProvider,
      subtotalCents: orders.subtotalCents,
      discountCents: orders.discountCents,
      shippingCents: orders.shippingCents,
      taxCents: orders.taxCents,
      totalCents: orders.totalCents,
      address: orders.shippingAddress,
      shippingMethod: orders.shippingMethod,
      status: orders.status,
      submittedAt: orders.fulfillmentSubmittedAt,
      shippedAt: orders.shippedAt,
      costCents: orders.costCents,
      processingFeeCents: orders.processingFeeCents,
      units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      holidayEligibleCents: sql<number>`coalesce(sum(case when ${orderItems.unitPriceCents} <= ${FL_HOLIDAY.itemCapCents} then ${orderItems.unitPriceCents} * ${orderItems.quantity} else 0 end), 0)::int`,
      itemsCostCents: sql<number>`coalesce(sum(${orderItems.unitCostCents} * ${orderItems.quantity}), 0)::int`,
      linesWithoutCost: sql<number>`(count(${orderItems.id}) filter (where ${orderItems.unitCostCents} is null))::int`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      and(
        isNotNull(orders.paidAt),
        sql`not (${orders.status} = 'CANCELLED' and coalesce(${orders.paymentProvider}, '') <> 'square')`,
      ),
    )
    .groupBy(orders.id)
    .orderBy(asc(orders.paidAt));
  const refundRows = await db
    .select({
      orderNumber: orders.orderNumber,
      at: orderEvents.createdAt,
      amountCents: sql<number>`coalesce((${orderEvents.data}->>'amountCents')::int, 0)`,
    })
    .from(orderEvents)
    .innerJoin(orders, eq(orders.id, orderEvents.orderId))
    .where(
      and(
        eq(orderEvents.type, "order.refunded"),
        isNotNull(orders.paidAt),
        // Square can accept a refund and fail it later. The order is flagged with
        // the same refund id when that happens, and the money never left.
        sql`not exists (
          select 1 from order_events failed
          where failed.order_id = order_events.order_id
            and failed.type = 'order.attention'
            and failed.data->>'refundId' = order_events.data->>'refundId'
        )`,
      ),
    );
  const expenseRows = await db.select().from(expenses);
  const recurringRows = await db.select().from(recurringCosts);
  const assumptions = await getAssumptions(db);

  const orderFacts: OrderFact[] = orderRows.map((row) => ({
    orderNumber: row.orderNumber,
    paidAt: row.paidAt as Date,
    provider: row.provider,
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    state: row.address?.state ?? "",
    postalCode: row.address?.postalCode ?? "",
    pickup: row.shippingMethod === PICKUP,
    units: row.units,
    holidayEligibleCents: row.holidayEligibleCents,
    itemsCostCents: row.itemsCostCents,
    linesWithoutCost: row.linesWithoutCost,
    costCents: row.costCents,
    processingFeeCents: row.processingFeeCents,
    neverMade:
      (row.status === "CANCELLED" || row.status === "REFUNDED") && !row.submittedAt && !row.shippedAt,
  }));

  const refunds: RefundFact[] = refundRows.filter((row) => row.amountCents > 0);
  const expenseFacts: ExpenseFact[] = expenseRows.map((row) => ({
    id: row.id,
    spentOn: row.spentOn,
    category: row.category,
    amountCents: row.amountCents,
    description: row.description,
  }));
  const recurring: RecurringFact[] = recurringRows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    amountCents: row.amountCents,
    every: row.every === "YEAR" ? "YEAR" : "MONTH",
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  }));

  return { orders: orderFacts, refunds, expenses: expenseFacts, recurring, assumptions };
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export type ExpenseRow = typeof expenses.$inferSelect;
export type RecurringRow = typeof recurringCosts.$inferSelect;

export const listExpenses = (db: Database, limit = 200): Promise<ExpenseRow[]> =>
  db.select().from(expenses).orderBy(desc(expenses.spentOn), desc(expenses.createdAt)).limit(limit);

export const listRecurring = (db: Database): Promise<RecurringRow[]> =>
  db.select().from(recurringCosts).orderBy(asc(recurringCosts.endsOn), asc(recurringCosts.name));

export async function addExpense(
  db: Database,
  actor: string,
  input: { spentOn: Day; category: ExpenseCategory; amountCents: number; description: string },
): Promise<void> {
  if (!isExpenseCategory(input.category)) throw new AccountingError("Pick what kind of expense it is.");
  await db.insert(expenses).values({ ...input, addedBy: actor });
}

export async function deleteExpense(db: Database, id: string): Promise<void> {
  await db.delete(expenses).where(eq(expenses.id, id));
}

export async function addRecurring(
  db: Database,
  actor: string,
  input: { name: string; category: ExpenseCategory; amountCents: number; every: "MONTH" | "YEAR"; startsOn: Day },
): Promise<void> {
  if (!isExpenseCategory(input.category)) throw new AccountingError("Pick what kind of cost it is.");
  await db.insert(recurringCosts).values({ ...input, addedBy: actor });
}

/**
 * Stops a repeating cost from the given day on. Charges up to then stay in the
 * books. A day before it ever started removes it altogether.
 */
export async function endRecurring(db: Database, id: string, lastDay: Day): Promise<void> {
  const [cost] = await db.select().from(recurringCosts).where(eq(recurringCosts.id, id)).limit(1);
  if (!cost) return;
  if (lastDay < cost.startsOn) {
    await db.delete(recurringCosts).where(eq(recurringCosts.id, id));
    return;
  }
  await db.update(recurringCosts).set({ endsOn: lastDay }).where(eq(recurringCosts.id, id));
}

export async function deleteRecurring(db: Database, id: string): Promise<void> {
  await db.delete(recurringCosts).where(eq(recurringCosts.id, id));
}

/* ------------------------------------------------------------------ */
/* What an order cost                                                  */
/* ------------------------------------------------------------------ */

/** Records what an order really cost to make and send, or clears it to go back to the items' own costs. */
export async function setOrderCost(
  db: Database,
  orderNumber: string,
  actor: string,
  costCents: number | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)
      .for("update");
    if (!order) throw new AccountingError("That order no longer exists.");
    await tx.update(orders).set({ costCents }).where(eq(orders.id, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      actor,
      type: "order.cost",
      message:
        costCents === null
          ? "Cost cleared. Using the cost of each item again."
          : `Cost to make and send set to $${(costCents / 100).toFixed(2)}`,
    });
  });
}

/** Website orders paid in the last two weeks whose real card fee hasn't been recorded yet. */
export const ordersAwaitingFee = (db: Database, limit: number) =>
  db
    .select({ id: orders.id, paymentRef: orders.paymentRef })
    .from(orders)
    .where(
      and(
        eq(orders.paymentProvider, "square"),
        isNotNull(orders.paymentRef),
        isNull(orders.processingFeeCents),
        gte(orders.paidAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(orders.paidAt))
    .limit(limit);

export const recordProcessingFee = (db: Database, orderId: string, feeCents: number) =>
  db.update(orders).set({ processingFeeCents: feeCents }).where(eq(orders.id, orderId));
