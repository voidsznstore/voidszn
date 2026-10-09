import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getDb, hasDatabase } from "@/db";
import { type PopupWithCode, enabledPopups } from "@/db/queries/popups";
import { codeProblem } from "@/lib/checkout/discounts";
import { discountSummary } from "@/lib/discounts/describe";
import { type LivePopup, POPUPS_TAG, isStorePath } from "./shape";

/**
 * Why a pop-up that is switched on still isn't shown, or null if it is. A
 * pop-up never offers a code that wouldn't work at checkout.
 */
export function whyHidden(popup: PopupWithCode, now = new Date()): string | null {
  if (popup.kind === "MESSAGE") {
    return popup.buttonUrl && isStorePath(popup.buttonUrl) ? null : "Its button has no page to go to.";
  }
  if (!popup.discount) {
    // A sign-up can run without a reward. A code offer is nothing without its code.
    return popup.kind === "CODE" ? "It has no discount code." : null;
  }
  const problem = codeProblem(popup.discount, now);
  return problem ? `Its code ${popup.discount.code} can't be used: ${problem.replace(/^That code /, "it ")}` : null;
}

const toLive = (popup: PopupWithCode): LivePopup => ({
  id: popup.id,
  kind: popup.kind,
  eyebrow: popup.eyebrow,
  headline: popup.headline,
  body: popup.body,
  buttonLabel: popup.buttonLabel,
  buttonUrl: popup.buttonUrl && isStorePath(popup.buttonUrl) ? popup.buttonUrl : null,
  trigger: popup.trigger,
  delaySeconds: popup.delaySeconds,
  pages: popup.pages,
  showAgainDays: popup.showAgainDays,
  offer:
    popup.kind === "CODE" && popup.discount
      ? { code: popup.discount.code, summary: discountSummary(popup.discount) }
      : null,
});

/**
 * The pop-ups the store may show, in the order to try them. Kept in the cache
 * so pages don't ask the database on every visit; saving a pop-up or a discount
 * code in the admin clears it at once.
 */
export async function getLivePopups(): Promise<LivePopup[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86_400 });
  cacheTag(POPUPS_TAG);
  if (!hasDatabase()) return [];
  try {
    const rows = await enabledPopups(getDb());
    return rows.filter((row) => whyHidden(row) === null).map(toLive);
  } catch (error) {
    // The store works without its pop-ups.
    console.error("[popups] Could not read the pop-ups", error);
    return [];
  }
}
