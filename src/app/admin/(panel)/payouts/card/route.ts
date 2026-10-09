import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/session";
import { CardPayoutError, cardSetupUrl } from "@/lib/payouts/card";
import { ownOrigin } from "@/lib/site-origin";

/**
 * Where Stripe sends someone back to when their card set-up link has expired or
 * was already used. It makes a fresh link for whoever is signed in and sends
 * them straight back to Stripe's form.
 *
 * Being a plain link, this never starts anything new: someone who hasn't begun
 * adding a card is sent to the Payouts screen to press the button there.
 */
export async function GET() {
  const admin = await requireAdmin();
  let url: string | null;
  try {
    url = await cardSetupUrl(admin, await ownOrigin(), { createAccount: false });
  } catch (error) {
    if (error instanceof CardPayoutError) redirect("/admin/payouts?card=problem");
    throw error;
  }
  redirect(url ?? "/admin/payouts");
}
