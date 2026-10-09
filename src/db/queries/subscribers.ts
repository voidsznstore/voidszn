import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../index";
import { customers, emailOptouts, subscribers } from "../schema";

/**
 * Adds an address to the marketing list because its owner ticked the box at
 * checkout and then paid, which is what shows the address is theirs.
 *
 * Someone who has unsubscribed stays unsubscribed: a tick on a form is not enough
 * to undo that, since the form can't tell who typed the address. Returns false
 * when the address was left off the list for that reason.
 */
export async function subscribe(db: Database, rawEmail: string, source: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const [optout] = await tx
      .select({ email: emailOptouts.email })
      .from(emailOptouts)
      .where(eq(emailOptouts.email, email))
      .limit(1);
    if (optout) return false;

    await tx
      .insert(subscribers)
      .values({ email, source, isEmailSubscribed: true })
      .onConflictDoUpdate({
        target: subscribers.email,
        set: { isEmailSubscribed: true, updatedAt: new Date() },
      });
    await tx
      .update(customers)
      .set({ acceptsEmail: true, updatedAt: new Date() })
      .where(eq(customers.email, email));
    return true;
  });
}

/** A fresh token for an unsubscribe link. */
const newToken = () => randomBytes(24).toString("base64url");

/**
 * Adds an address to the marketing list because its owner typed it into a
 * sign-up form on the store. `source` says which form, and is only kept for an
 * address that wasn't on the list before.
 *
 * As with `subscribe`, someone who has unsubscribed stays unsubscribed: `token`
 * comes back null and nothing must be sent to them. Otherwise `token` is what
 * goes in the unsubscribe link of an email sent to this address.
 */
export async function joinList(db: Database, rawEmail: string, source: string): Promise<{ token: string | null }> {
  const email = rawEmail.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const [optout] = await tx
      .select({ email: emailOptouts.email })
      .from(emailOptouts)
      .where(eq(emailOptouts.email, email))
      .limit(1);
    if (optout) return { token: null };

    const [row] = await tx
      .insert(subscribers)
      .values({ email, source, isEmailSubscribed: true, unsubscribeToken: newToken() })
      .onConflictDoUpdate({
        target: subscribers.email,
        set: {
          isEmailSubscribed: true,
          // Keep the token they already have, so links in earlier emails go on working.
          unsubscribeToken: sql`coalesce(${subscribers.unsubscribeToken}, excluded.unsubscribe_token)`,
          updatedAt: new Date(),
        },
      })
      .returning({ token: subscribers.unsubscribeToken });
    await tx
      .update(customers)
      .set({ acceptsEmail: true, updatedAt: new Date() })
      .where(eq(customers.email, email));
    return { token: row.token };
  });
}

/**
 * Takes the one welcome email this address will ever get. True if it is this
 * caller's to send. False if it has gone already, or if `perHour` welcomes
 * went out in the last hour: a flood of sign-ups must not become a flood of mail.
 */
export async function claimWelcome(db: Database, rawEmail: string, perHour: number): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  const claimed = await db
    .update(subscribers)
    .set({ welcomeSentAt: new Date() })
    .where(
      and(
        eq(subscribers.email, email),
        eq(subscribers.isEmailSubscribed, true),
        isNull(subscribers.welcomeSentAt),
        sql`(select count(*) from ${subscribers} as recent where recent.welcome_sent_at > now() - interval '1 hour') < ${perHour}`,
      ),
    )
    .returning({ id: subscribers.id });
  return claimed.length === 1;
}

/** Hands the welcome back when it could not be sent. */
export async function releaseWelcome(db: Database, rawEmail: string): Promise<void> {
  await db
    .update(subscribers)
    .set({ welcomeSentAt: null })
    .where(eq(subscribers.email, rawEmail.trim().toLowerCase()));
}

/** The address a subscriber's own unsubscribe link belongs to. */
export async function subscriberForToken(db: Database, token: string): Promise<string | null> {
  const [row] = await db
    .select({ email: subscribers.email })
    .from(subscribers)
    .where(eq(subscribers.unsubscribeToken, token))
    .limit(1);
  return row?.email ?? null;
}
