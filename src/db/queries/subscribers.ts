import { eq } from "drizzle-orm";
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
