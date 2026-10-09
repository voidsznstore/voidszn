import "server-only";
import { and, count, eq, gt, inArray, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { adminLoginAttempts } from "@/db/schema";

/**
 * Slows down password guessing. Failed sign-ins are counted over a short window:
 *
 * - per email from one network address (the tight limit),
 * - per network address across all emails,
 * - per email across all addresses. This one is loose on purpose, so a stranger
 *   who knows the owner's email can't lock the owner out by guessing badly.
 *
 * Past a limit, sign-in is refused until the window passes, whether or not the
 * password is right.
 */
const WINDOW_MINUTES = 15;
const LIMITS = { pair: 5, address: 20, email: 30 } as const;

export type AttemptKeys = { pair: string; address: string; email: string };

export async function attemptKeys(email: string): Promise<AttemptKeys> {
  const forwarded = (await headers()).get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || "unknown";
  return {
    pair: `pair:${email}|${address}`,
    address: `ip:${address}`,
    email: `email:${email}`,
  };
}

const windowStart = () => new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

export async function isLockedOut(keys: AttemptKeys): Promise<boolean> {
  const rows = await getDb()
    .select({ key: adminLoginAttempts.key, failures: count() })
    .from(adminLoginAttempts)
    .where(
      and(
        inArray(adminLoginAttempts.key, Object.values(keys)),
        gt(adminLoginAttempts.createdAt, windowStart()),
      ),
    )
    .groupBy(adminLoginAttempts.key);

  const failures = (key: string) => rows.find((row) => row.key === key)?.failures ?? 0;
  return (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).some(
    (name) => failures(keys[name]) >= LIMITS[name],
  );
}

export async function recordFailure(keys: AttemptKeys): Promise<void> {
  const db = getDb();
  await db.insert(adminLoginAttempts).values(Object.values(keys).map((key) => ({ key })));
  // Old rows are no use to anyone.
  await db
    .delete(adminLoginAttempts)
    .where(lt(adminLoginAttempts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}

/** A correct sign-in clears the count for that email from that address. */
export async function clearFailures(keys: AttemptKeys): Promise<void> {
  await getDb().delete(adminLoginAttempts).where(eq(adminLoginAttempts.key, keys.pair));
}

export const LOCKOUT_MESSAGE = `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`;

/* A simple counter for anything else that needs slowing down. */

export async function clientAddress(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** True once `key` has been counted `limit` times in the last 15 minutes. */
export async function isOverLimit(key: string, limit: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ failures: count() })
    .from(adminLoginAttempts)
    .where(and(eq(adminLoginAttempts.key, key), gt(adminLoginAttempts.createdAt, windowStart())));
  return row.failures >= limit;
}

export async function countAgainst(key: string): Promise<void> {
  await getDb().insert(adminLoginAttempts).values({ key });
}
