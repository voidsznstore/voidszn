import { and, asc, count, desc, eq, exists, gte, ilike, notExists, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import { type Address, customers, emailOptouts, orders, subscribers } from "../schema";
import { FormError } from "./admin-catalog";

/** Orders that count as a sale: paid for and not cancelled or fully refunded. */
const SOLD = sql`${orders.status} in ('PAID', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED')`;

// Each is wrapped once more on purpose: in a one-table query the library drops table
// names from columns written straight into a selected field, and "id" would then
// mean the order's own id inside the sub-query.
const orderCount = sql<number>`${sql`(select count(*)::int from ${orders} where ${orders.customerId} = ${customers.id})`}`;
const spentCents = sql<number>`${sql`(select coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)::int from ${orders} where ${orders.customerId} = ${customers.id} and ${SOLD})`}`;
const lastOrderAt = sql<Date | null>`${sql`(select max(${orders.createdAt}) from ${orders} where ${orders.customerId} = ${customers.id})`}`;

const optedOut = (db: Database) =>
  exists(
    db.select({ one: sql`1` }).from(emailOptouts).where(eq(emailOptouts.email, customers.email)),
  );

export const CUSTOMER_VIEWS = {
  all: "All",
  new: "New",
  returning: "Returning",
  emails: "Get emails",
} as const;
export type CustomerView = keyof typeof CUSTOMER_VIEWS;

/** How long someone counts as a new customer. */
export const NEW_CUSTOMER_DAYS = 30;

export const CUSTOMER_SORTS = {
  newest: "Newest",
  spent: "Spent most",
  orders: "Most orders",
  name: "Name",
} as const;
export type CustomerSort = keyof typeof CUSTOMER_SORTS;

const newSince = () => new Date(Date.now() - NEW_CUSTOMER_DAYS * 24 * 60 * 60 * 1000);

function viewFilter(db: Database, view: CustomerView | undefined) {
  switch (view) {
    case "new":
      return gte(customers.createdAt, newSince());
    case "returning":
      return sql`${orderCount} >= 2`;
    case "emails":
      return and(eq(customers.acceptsEmail, true), sql`not ${optedOut(db)}`);
    default:
      return undefined;
  }
}

export type CustomerRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  createdAt: Date;
  /** Added within the last `NEW_CUSTOMER_DAYS` days. */
  isNew: boolean;
  acceptsEmail: boolean;
  optedOut: boolean;
  orders: number;
  spentCents: number;
  lastOrderAt: Date | null;
};

export async function listCustomers(
  db: Database,
  filters: { view?: CustomerView; q?: string; sort?: CustomerSort },
): Promise<CustomerRow[]> {
  const q = filters.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;

  return db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      createdAt: customers.createdAt,
      isNew: sql<boolean>`${customers.createdAt} >= ${newSince()}`,
      acceptsEmail: customers.acceptsEmail,
      optedOut: sql<boolean>`${optedOut(db)}`,
      orders: orderCount,
      spentCents,
      lastOrderAt,
    })
    .from(customers)
    .where(
      and(
        viewFilter(db, filters.view),
        pattern
          ? or(
              ilike(customers.name, pattern),
              ilike(customers.email, pattern),
              ilike(customers.phone, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(
      ...(filters.sort === "spent"
        ? [desc(spentCents), desc(customers.createdAt)]
        : filters.sort === "orders"
          ? [desc(orderCount), desc(customers.createdAt)]
          : filters.sort === "name"
            ? [asc(sql`lower(coalesce(${customers.name}, ${customers.email}))`)]
            : [desc(customers.createdAt)]),
    )
    .limit(500);
}

export async function countCustomerViews(db: Database): Promise<Record<CustomerView, number>> {
  const total = (view: CustomerView) =>
    db.select({ value: count() }).from(customers).where(viewFilter(db, view));
  const [[all], [fresh], [returning], [emails]] = await Promise.all([
    total("all"),
    total("new"),
    total("returning"),
    total("emails"),
  ]);
  return { all: all.value, new: fresh.value, returning: returning.value, emails: emails.value };
}

export async function getCustomer(db: Database, id: string) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!customer) return null;

  const [history, [optout]] = await Promise.all([
    db
      .select({
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
        status: orders.status,
        totalCents: orders.totalCents,
        refundedCents: orders.refundedCents,
      })
      .from(orders)
      .where(eq(orders.customerId, id))
      .orderBy(desc(orders.createdAt)),
    db.select().from(emailOptouts).where(eq(emailOptouts.email, customer.email)).limit(1),
  ]);

  const sold = history.filter((order) =>
    ["PAID", "IN_PRODUCTION", "SHIPPED", "DELIVERED"].includes(order.status),
  );
  return {
    customer,
    orders: history,
    spentCents: sold.reduce((sum, order) => sum + order.totalCents - order.refundedCents, 0),
    /** Set when they unsubscribed themselves. */
    optedOutAt: optout?.createdAt ?? null,
  };
}

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

export type CustomerInput = {
  name: string;
  email: string;
  phone: string;
  /** Null when no address is known. */
  address: Address | null;
  acceptsEmail: boolean;
  notes: string;
};

const fields = (input: CustomerInput) => ({
  name: input.name.trim() || null,
  email: input.email.trim().toLowerCase(),
  phone: input.phone.trim() || null,
  defaultAddress: input.address,
  acceptsEmail: input.acceptsEmail,
  notes: input.notes.trim() || null,
});

const isDuplicate = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";

/** Unwraps the database's own error from the one the query library throws. */
const cause = (error: unknown) =>
  typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause: unknown }).cause
    : error;

/**
 * Saying yes to marketing emails again clears an earlier unsubscribe. The form
 * tells the owner only to do that when the customer asked.
 */
async function applyConsent(db: Pick<Database, "delete">, email: string, acceptsEmail: boolean) {
  if (acceptsEmail) await db.delete(emailOptouts).where(eq(emailOptouts.email, email));
}

export async function createCustomer(db: Database, input: CustomerInput): Promise<string> {
  const values = fields(input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(customers).values(values).returning({ id: customers.id });
      await applyConsent(tx, values.email, values.acceptsEmail);
      return row.id;
    });
  } catch (error) {
    if (isDuplicate(error) || isDuplicate(cause(error))) {
      throw new FormError("There is already a customer with that email.");
    }
    throw error;
  }
}

export async function updateCustomer(db: Database, id: string, input: CustomerInput): Promise<void> {
  const values = fields(input);
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(customers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning({ id: customers.id });
      if (!row) throw new FormError("That customer no longer exists.");
      await applyConsent(tx, values.email, values.acceptsEmail);
    });
  } catch (error) {
    if (isDuplicate(error) || isDuplicate(cause(error))) {
      throw new FormError("Another customer already has that email.");
    }
    throw error;
  }
}

/** Removes a customer who has never ordered. Customers with orders are kept for the records. */
export async function deleteCustomer(db: Database, id: string): Promise<void> {
  const [{ value }] = await db.select({ value: count() }).from(orders).where(eq(orders.customerId, id));
  if (value > 0) {
    throw new FormError("This customer has orders, so they can't be deleted.");
  }
  await db.delete(customers).where(eq(customers.id, id));
}

/* ------------------------------------------------------------------ */
/* Who marketing emails go to                                          */
/* ------------------------------------------------------------------ */

export type Recipient = { email: string; name: string | null };

/**
 * Everyone who agreed to marketing emails and hasn't unsubscribed: customers
 * marked as agreed, plus newsletter sign-ups. One entry per address.
 */
export async function listMarketingRecipients(db: Database): Promise<Recipient[]> {
  const notOptedOut = (email: typeof customers.email | typeof subscribers.email) =>
    notExists(db.select({ one: sql`1` }).from(emailOptouts).where(eq(emailOptouts.email, sql`lower(${email})`)));

  const [fromCustomers, fromSubscribers] = await Promise.all([
    db
      .select({ email: customers.email, name: customers.name })
      .from(customers)
      .where(and(eq(customers.acceptsEmail, true), notOptedOut(customers.email))),
    db
      .select({ email: subscribers.email })
      .from(subscribers)
      .where(and(eq(subscribers.isEmailSubscribed, true), notOptedOut(subscribers.email))),
  ]);

  const byEmail = new Map<string, Recipient>();
  for (const row of fromSubscribers) byEmail.set(row.email.toLowerCase(), { email: row.email.toLowerCase(), name: null });
  for (const row of fromCustomers) byEmail.set(row.email.toLowerCase(), { email: row.email.toLowerCase(), name: row.name });
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}
