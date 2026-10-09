import "server-only";
import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { type Database, getDb, hasDatabase } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Slows down anyone hammering the public endpoints: starting checkouts, pricing
 * carts, trying discount codes, signing up through a pop-up.
 *
 * Calls are counted per caller in fixed windows, in the database, because the
 * site runs as many short-lived copies that share nothing else. Counting is one
 * statement, so two calls at the same moment can't both slip under the limit.
 *
 * If the count can't be kept (no database, or it didn't answer), the call is let
 * through. A limiter must never be the reason someone can't pay.
 */
export type Limit = { name: string; max: number; windowSeconds: number };

export const LIMITS = {
  /** Opening a payment page. Each one is a call to Square. Per network address. */
  checkout: { name: "checkout", max: 15, windowSeconds: 10 * 60 },
  /** The same, per email address: starting checkout can lead to reminder emails. */
  checkoutEmail: { name: "checkout-email", max: 10, windowSeconds: 60 * 60 },
  /** Pricing a cart. The checkout page asks again on every change, so this is loose. */
  quote: { name: "quote", max: 150, windowSeconds: 5 * 60 },
  /** Codes that don't exist. Stops a script guessing its way to a real one. */
  codeGuess: { name: "code", max: 12, windowSeconds: 10 * 60 },
  /** Signing up through a pop-up. */
  signUp: { name: "sign-up", max: 8, windowSeconds: 10 * 60 },
} as const satisfies Record<string, Limit>;

/**
 * The network address a request came from. Vercel writes `x-forwarded-for`
 * itself and throws away whatever the caller put there, so it can't be faked.
 * (Other headers that look like they'd do, such as `x-real-ip`, come with no
 * such promise, so they are not used.)
 */
export function callerOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** What is stored. Never the address or email itself. */
const keyFor = (limit: Limit, subject: string) =>
  createHash("sha256").update(`${limit.name}:${subject.trim().toLowerCase()}`).digest("hex").slice(0, 40);

const windowOf = (limit: Limit) =>
  sql`to_timestamp(floor(extract(epoch from now()) / ${limit.windowSeconds}) * ${limit.windowSeconds})`;

/** Counts one call by `subject`. False once they are over the limit. */
export async function take(limit: Limit, subject: string): Promise<boolean> {
  if (!hasDatabase()) return true;
  try {
    const result = await getDb().execute<{ hits: number }>(sql`
      insert into rate_limits (key, window_start, hits)
      values (${keyFor(limit, subject)}, ${windowOf(limit)}, 1)
      on conflict (key, window_start) do update set hits = rate_limits.hits + 1
      returning hits
    `);
    return (result.rows[0]?.hits ?? 1) <= limit.max;
  } catch (error) {
    console.error(`[rate-limit] Could not count a ${limit.name} call. Letting it through.`, error);
    return true;
  }
}

/** Whether `subject` has already used the limit up, without counting this call. */
export async function isSpent(limit: Limit, subject: string): Promise<boolean> {
  if (!hasDatabase()) return false;
  try {
    const result = await getDb().execute<{ hits: number }>(sql`
      select hits from rate_limits
      where key = ${keyFor(limit, subject)} and window_start = ${windowOf(limit)}
    `);
    return (result.rows[0]?.hits ?? 0) >= limit.max;
  } catch (error) {
    console.error(`[rate-limit] Could not read a ${limit.name} count. Letting it through.`, error);
    return false;
  }
}

export const TOO_MANY = "Too many tries. Wait a few minutes and try again.";

/** The answer for a caller who is over a limit. */
export function tooMany(limit: Limit, body: Record<string, unknown> = {}): Response {
  return Response.json(
    { error: TOO_MANY, ...body },
    { status: 429, headers: { "Retry-After": String(limit.windowSeconds) } },
  );
}

/** Clears counts from windows that ended long ago. Run by the timed job. */
export async function clearOldLimits(db: Database): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}
