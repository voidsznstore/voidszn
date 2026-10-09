import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import type { DiscountKind } from "@/lib/discounts/describe";
import type { Database } from "../index";
import { discountCodes, orders } from "../schema";
import { FormError } from "./admin-catalog";

/**
 * Discount codes, as the admin sees them. What a code takes off an order is
 * worked out in `lib/checkout/discounts.ts`.
 */

export const DISCOUNT_VIEWS = {
  all: "All",
  active: "Active",
  scheduled: "Scheduled",
  ended: "Ended",
} as const;
export type DiscountView = keyof typeof DISCOUNT_VIEWS;

export const DISCOUNT_TYPES = {
  any: "Any type",
  PERCENTAGE: "Percentage off",
  FIXED: "Amount off",
  FREE_SHIPPING: "Free shipping",
} as const;
export type DiscountTypeFilter = keyof typeof DISCOUNT_TYPES;

export const DISCOUNT_SORTS = {
  newest: "Newest",
  code: "Code, A to Z",
  used: "Most used",
  biggest: "Biggest discount",
  ending: "Ending soonest",
} as const;
export type DiscountSort = keyof typeof DISCOUNT_SORTS;

export type DiscountRow = typeof discountCodes.$inferSelect;

/** Where a code stands right now, in one word. */
export type DiscountState = "active" | "scheduled" | "expired" | "used_up" | "off";

export function discountState(row: DiscountRow, now = new Date()): DiscountState {
  if (!row.isActive) return "off";
  if (row.expiresAt && row.expiresAt <= now) return "expired";
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return "used_up";
  if (row.startsAt && row.startsAt > now) return "scheduled";
  return "active";
}

export const DISCOUNT_STATE_LABELS: Record<DiscountState, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  used_up: "Used up",
  off: "Turned off",
};

// These mirror `discountState`, as conditions the database can filter on.
const isExpired = sql`(${discountCodes.expiresAt} is not null and ${discountCodes.expiresAt} <= now())`;
const isUsedUp = sql`(${discountCodes.maxUses} is not null and ${discountCodes.usedCount} >= ${discountCodes.maxUses})`;
const isScheduled = sql`(${discountCodes.startsAt} is not null and ${discountCodes.startsAt} > now())`;
const viewFilter = (view: DiscountView) => {
  switch (view) {
    case "active":
      return sql`${discountCodes.isActive} and not ${isExpired} and not ${isUsedUp} and not ${isScheduled}`;
    case "scheduled":
      return sql`${discountCodes.isActive} and not ${isExpired} and not ${isUsedUp} and ${isScheduled}`;
    case "ended":
      return sql`(not ${discountCodes.isActive} or ${isExpired} or ${isUsedUp})`;
    case "all":
      return undefined;
  }
};

export async function listDiscounts(
  db: Database,
  options: { view: DiscountView; type: DiscountTypeFilter; q: string; sort: DiscountSort },
): Promise<DiscountRow[]> {
  const order = {
    newest: [desc(discountCodes.createdAt)],
    code: [asc(discountCodes.code)],
    used: [desc(discountCodes.usedCount), desc(discountCodes.createdAt)],
    // Percentages first, biggest first, then amounts, biggest first, then free shipping.
    biggest: [asc(discountCodes.type), desc(discountCodes.value)],
    ending: [sql`${discountCodes.expiresAt} asc nulls last`, desc(discountCodes.createdAt)],
  }[options.sort];

  return db
    .select()
    .from(discountCodes)
    .where(
      and(
        viewFilter(options.view),
        options.type === "any" ? undefined : eq(discountCodes.type, options.type),
        options.q ? ilike(discountCodes.code, `%${options.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
      ),
    )
    .orderBy(...order)
    .limit(500);
}

export async function countDiscountViews(db: Database): Promise<Record<DiscountView, number>> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${viewFilter("active")})::int`,
      scheduled: sql<number>`count(*) filter (where ${viewFilter("scheduled")})::int`,
      ended: sql<number>`count(*) filter (where ${viewFilter("ended")})::int`,
    })
    .from(discountCodes);
  return row ?? { all: 0, active: 0, scheduled: 0, ended: 0 };
}

/** Codes that can be used right now or will be soon, for pickers in the email screens. */
export async function listUsableDiscounts(db: Database): Promise<DiscountRow[]> {
  return db
    .select()
    .from(discountCodes)
    .where(sql`${discountCodes.isActive} and not ${isExpired} and not ${isUsedUp}`)
    .orderBy(asc(discountCodes.code))
    .limit(500);
}

export async function getDiscount(db: Database, id: string) {
  const [discount] = await db.select().from(discountCodes).where(eq(discountCodes.id, id)).limit(1);
  if (!discount) return null;

  const [[totals], recent] = await Promise.all([
    db
      .select({
        orders: sql<number>`count(*)::int`,
        discountCents: sql<number>`coalesce(sum(${orders.discountCents}), 0)::int`,
        salesCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(eq(orders.discountCodeId, id)),
    db
      .select({
        orderNumber: orders.orderNumber,
        email: orders.email,
        totalCents: orders.totalCents,
        discountCents: orders.discountCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.discountCodeId, id))
      .orderBy(desc(orders.createdAt))
      .limit(20),
  ]);
  return { discount, totals: totals ?? { orders: 0, discountCents: 0, salesCents: 0 }, recent };
}

export type DiscountInput = {
  code: string;
  type: DiscountKind;
  /** PERCENTAGE: 1 to 100. FIXED: cents. FREE_SHIPPING: ignored. */
  value: number;
  minOrderCents: number;
  maxUses: number | null;
  oncePerCustomer: boolean;
  /** Only for an email that has never ordered. Off unless said. */
  firstOrderOnly?: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  note: string;
};

const fields = (input: DiscountInput) => ({
  code: input.code,
  type: input.type,
  value: input.type === "FREE_SHIPPING" ? 0 : input.value,
  minOrderCents: input.minOrderCents,
  maxUses: input.maxUses,
  perCustomerLimit: input.oncePerCustomer ? 1 : null,
  firstOrderOnly: input.firstOrderOnly ?? false,
  startsAt: input.startsAt,
  expiresAt: input.expiresAt,
  isActive: input.isActive,
  note: input.note.trim() || null,
});

/** Postgres's code for "that value is already taken". */
const isDuplicate = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23505" ||
    (error as { cause?: { code?: string } }).cause?.code === "23505");

export async function createDiscount(db: Database, input: DiscountInput): Promise<string> {
  try {
    const [row] = await db.insert(discountCodes).values(fields(input)).returning({ id: discountCodes.id });
    return row.id;
  } catch (error) {
    if (isDuplicate(error)) throw new FormError(`There is already a code called ${input.code}.`);
    throw error;
  }
}

export async function updateDiscount(db: Database, id: string, input: DiscountInput): Promise<void> {
  const [current] = await db
    .select({ usedCount: discountCodes.usedCount })
    .from(discountCodes)
    .where(eq(discountCodes.id, id))
    .limit(1);
  if (!current) throw new FormError("That code no longer exists.");
  if (input.maxUses !== null && input.maxUses < current.usedCount) {
    throw new FormError(
      `This code has already been used ${current.usedCount} times, so the limit can't be lower than that.`,
    );
  }
  try {
    await db
      .update(discountCodes)
      .set({ ...fields(input), updatedAt: new Date() })
      .where(eq(discountCodes.id, id));
  } catch (error) {
    if (isDuplicate(error)) throw new FormError(`There is already a code called ${input.code}.`);
    throw error;
  }
}

export async function setDiscountActive(db: Database, id: string, isActive: boolean): Promise<void> {
  await db.update(discountCodes).set({ isActive, updatedAt: new Date() }).where(eq(discountCodes.id, id));
}

/** Orders that used the code keep its name and what it took off. */
export async function deleteDiscount(db: Database, id: string): Promise<void> {
  await db.delete(discountCodes).where(eq(discountCodes.id, id));
}
