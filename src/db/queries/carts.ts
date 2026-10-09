import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import { type CartSnapshotItem, abandonedCarts, orders } from "../schema";

/**
 * Carts someone started to pay for. A cart is saved the moment a customer gives
 * their email and heads to the payment page. If no order follows, reminders go
 * out; once an order arrives from that person, the cart is closed.
 */

export type SavedCart = typeof abandonedCarts.$inferSelect;

const OPEN_STATES = ["OPEN", "EMAILED"] as const;
/** How many reminders there are in a series. */
export const MAX_REMINDERS = 3;
/** One series per address in this many days. */
const REMINDER_CAP_DAYS = 30;
/** The least time between two reminders about the same cart. */
const MIN_GAP_HOURS = 12;
/** After this long a cart is left alone for good. */
export const CART_LIFETIME_DAYS = 7;

/**
 * Saves the cart for this address, replacing any earlier unfinished one. Starting
 * checkout again restarts the reminders, so nobody is chased about an old cart
 * while they are in the middle of buying.
 */
export async function saveCart(
  db: Database,
  input: { email: string; items: CartSnapshotItem[]; totalCents: number; paymentOrderRef: string | null },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    // One at a time per address, so two checkouts started together can't leave two carts.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cart:${email}`}))`);
    const [existing] = await tx
      .select({ id: abandonedCarts.id })
      .from(abandonedCarts)
      .where(and(eq(abandonedCarts.email, email), inArray(abandonedCarts.status, [...OPEN_STATES])))
      .orderBy(asc(abandonedCarts.createdAt))
      .limit(1)
      .for("update");

    const fields = {
      items: input.items,
      totalCents: input.totalCents,
      paymentOrderRef: input.paymentOrderRef,
      leftAt: new Date(),
    };
    if (existing) {
      // The reminders already sent for this cart still count. Coming back to
      // checkout moves the clock, it doesn't start the series again.
      await tx.update(abandonedCarts).set(fields).where(eq(abandonedCarts.id, existing.id));
      return;
    }

    // An address gets at most one series of reminders a month, however many carts
    // are started with it. A new cart carries on from where the last one got to.
    const [recent] = await tx
      .select({ sent: sql<number>`coalesce(sum(${abandonedCarts.emailsSent}), 0)::int` })
      .from(abandonedCarts)
      .where(
        and(
          eq(abandonedCarts.email, email),
          sql`${abandonedCarts.createdAt} > now() - make_interval(days => ${REMINDER_CAP_DAYS})`,
        ),
      );
    await tx.insert(abandonedCarts).values({
      email,
      recoveryToken: randomBytes(24).toString("base64url"),
      ...fields,
      emailsSent: Math.min(recent?.sent ?? 0, MAX_REMINDERS),
    });
  });
}

/** Closes any unfinished cart that belongs to an order that has now been paid. */
export async function markCartsRecovered(
  db: Database,
  input: { email: string; paymentOrderRef?: string | null; orderNumber: string },
): Promise<void> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNumber, input.orderNumber))
    .limit(1);
  const email = input.email.trim().toLowerCase();
  await db
    .update(abandonedCarts)
    .set({ status: "RECOVERED", recoveredOrderId: order?.id ?? null })
    .where(
      and(
        inArray(abandonedCarts.status, [...OPEN_STATES]),
        input.paymentOrderRef
          ? or(eq(abandonedCarts.email, email), eq(abandonedCarts.paymentOrderRef, input.paymentOrderRef))
          : eq(abandonedCarts.email, email),
      ),
    );
}

/** The cart behind a link in a reminder email. */
export async function findCartByToken(db: Database, token: string): Promise<SavedCart | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select()
    .from(abandonedCarts)
    .where(eq(abandonedCarts.recoveryToken, token))
    .limit(1);
  return row ?? null;
}

/**
 * Tidies up before reminders go out: carts that are too old, belong to someone
 * who unsubscribed, or whose owner has ordered since, are closed.
 */
export async function closeFinishedCarts(db: Database): Promise<void> {
  const open = inArray(abandonedCarts.status, [...OPEN_STATES]);
  const cutoff = new Date(Date.now() - CART_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await db
    .update(abandonedCarts)
    .set({ status: "RECOVERED" })
    .where(
      and(
        open,
        // Written out by name: inside a one-table statement the query builder drops
        // table names, and "email = email" would match every row.
        sql`exists (select 1 from orders o where o.email = abandoned_carts.email and o.created_at >= abandoned_carts.left_at)`,
      ),
    );
  await db
    .update(abandonedCarts)
    .set({ status: "EXPIRED" })
    .where(
      and(
        open,
        or(
          lt(abandonedCarts.leftAt, cutoff),
          sql`exists (select 1 from email_optouts x where x.email = abandoned_carts.email)`,
        ),
      ),
    );
}

/**
 * Takes the carts due their next reminder and marks the reminder as sent, in one
 * step, so a cart can never be taken twice for the same reminder.
 *
 * `step` is which reminder (0 is the first). A cart is due when it has had exactly
 * `step` reminders and was left at least `afterHours` ago.
 */
export async function claimDueCarts(
  db: Database,
  step: number,
  afterHours: number,
  limit = 50,
): Promise<SavedCart[]> {
  const due = new Date(Date.now() - afterHours * 60 * 60 * 1000);
  const spaced = new Date(Date.now() - MIN_GAP_HOURS * 60 * 60 * 1000);
  return db
    .update(abandonedCarts)
    .set({ emailsSent: step + 1, lastEmailedAt: new Date(), status: "EMAILED" })
    .where(
      inArray(
        abandonedCarts.id,
        db
          .select({ id: abandonedCarts.id })
          .from(abandonedCarts)
          .where(
            and(
              inArray(abandonedCarts.status, [...OPEN_STATES]),
              eq(abandonedCarts.emailsSent, step),
              lt(abandonedCarts.leftAt, due),
              // Never two reminders close together, even if sending fell behind.
              or(isNull(abandonedCarts.lastEmailedAt), lt(abandonedCarts.lastEmailedAt, spaced)),
              // Checked again at the moment of taking, in case they unsubscribed
              // or ordered since the tidy-up at the start of the run.
              sql`not exists (select 1 from email_optouts x where x.email = abandoned_carts.email)`,
              sql`not exists (select 1 from orders o where o.email = abandoned_carts.email and o.created_at >= abandoned_carts.left_at)`,
            ),
          )
          .orderBy(asc(abandonedCarts.leftAt))
          .limit(limit)
          .for("update", { skipLocked: true }),
      ),
    )
    .returning();
}

/** Counts for the admin: how many carts are waiting, were reminded, came back, or lapsed. */
export async function countCarts(db: Database, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      status: abandonedCarts.status,
      reminded: sql<boolean>`${abandonedCarts.emailsSent} > 0`,
      value: sql<number>`count(*)::int`,
      cents: sql<number>`coalesce(sum(${abandonedCarts.totalCents}), 0)::int`,
    })
    .from(abandonedCarts)
    .where(sql`${abandonedCarts.createdAt} >= ${since}`)
    .groupBy(abandonedCarts.status, sql`${abandonedCarts.emailsSent} > 0`);

  const counts = { waiting: 0, reminded: 0, recovered: 0, recoveredCents: 0 };
  for (const row of rows) {
    if (row.status === "OPEN" || row.status === "EMAILED") counts.waiting += row.value;
    if (row.reminded) counts.reminded += row.value;
    if (row.status === "RECOVERED" && row.reminded) {
      counts.recovered += row.value;
      counts.recoveredCents += row.cents;
    }
  }
  return counts;
}
