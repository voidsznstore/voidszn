import "server-only";
import Stripe from "stripe";
import { siteConfig } from "@/lib/site-config";

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** The Stripe client. Created on first use so builds work before keys exist. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  client ??= new Stripe(key, {
    maxNetworkRetries: 2,
    appInfo: { name: "voidszn-storefront", url: siteConfig.url },
  });
  return client;
}

let taxCheck: { active: boolean; checkedAt: number } | null = null;
const TAX_CHECK_TTL_MS = 5 * 60 * 1000;

/**
 * Whether Stripe Tax is set up on the account (a head office address is saved).
 * Checkout only turns on automatic tax when this is true, because turning it on
 * for an account that is not set up makes every checkout fail.
 *
 * Even when this is true, tax is only collected in places where a tax
 * registration has been added in Stripe.
 */
export async function isTaxActive(): Promise<boolean> {
  if (taxCheck && Date.now() - taxCheck.checkedAt < TAX_CHECK_TTL_MS) return taxCheck.active;
  try {
    const settings = await getStripe().tax.settings.retrieve();
    taxCheck = { active: settings.status === "active", checkedAt: Date.now() };
  } catch (error) {
    console.error("[payments] Could not read tax settings", error);
    taxCheck = { active: false, checkedAt: Date.now() };
  }
  return taxCheck.active;
}
