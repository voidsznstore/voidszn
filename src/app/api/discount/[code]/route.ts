import { getDb, hasDatabase } from "@/db";
import { findDiscountByCode } from "@/db/queries/discounts";
import { codeProblem } from "@/lib/checkout/discounts";
import { CODE_PATTERN, discountSummary, normalizeCode } from "@/lib/discounts/describe";
import { LIMITS, callerOf, isSpent, take, tooMany } from "@/lib/rate-limit";

/**
 * Says what a code is worth, for the note shown when someone arrives through a
 * link that carries one. Checkout checks the code again against the cart.
 */
export async function GET(request: Request, context: RouteContext<"/api/discount/[code]">) {
  const { code: raw } = await context.params;
  const code = normalizeCode(raw);
  const invalid = Response.json({ ok: false, error: "That code isn't valid." });
  if (!CODE_PATTERN.test(code) || !hasDatabase()) return invalid;

  // Codes that don't exist are counted, so nobody can guess their way to a real one.
  const caller = callerOf(request);
  if (await isSpent(LIMITS.codeGuess, caller)) return tooMany(LIMITS.codeGuess, { ok: false });

  const row = await findDiscountByCode(getDb(), code);
  if (!row) {
    await take(LIMITS.codeGuess, caller);
    return invalid;
  }
  const problem = codeProblem(row);
  if (problem) return Response.json({ ok: false, error: problem });
  return Response.json({ ok: true, code: row.code, summary: discountSummary(row) });
}
