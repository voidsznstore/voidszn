import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe, used for one thing: paying partners their share to a debit card.
 * Customers never pay through Stripe; the store's checkout is Square.
 *
 * How the money moves:
 *   the store's Stripe balance  --transfer-->  the partner's Stripe account
 *                               --instant payout-->  the partner's debit card
 *
 * The store's Stripe balance has to hold the money first. It is topped up from
 * the business bank account in the Stripe Dashboard ("Add to balance").
 *
 * Each partner has a connected account made with the Accounts v2 API, set up to
 * receive transfers only. Stripe's own hosted form checks who they are and takes
 * their card, so no card number ever reaches this site.
 *
 * Needs STRIPE_SECRET_KEY (a restricted key is best). Without it, nothing here
 * is used and payouts are sent by hand.
 */

const API_VERSION = process.env.STRIPE_API_VERSION ?? "2026-08-26.dahlia";
// Lets the automated checks run against a stand-in for Stripe.
const host = () => process.env.STRIPE_API_URL ?? "https://api.stripe.com";

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    /** Stripe's own error code, e.g. balance_insufficient. Safe to log. */
    readonly code: string,
    /** Stripe's explanation, written for the account owner. Safe to show in the admin. */
    readonly detail: string,
  ) {
    super(`Stripe request failed (${status}${code ? `: ${code}` : ""})`);
  }
}

type CallOptions = {
  method?: "GET" | "POST";
  /** v1 endpoints take form fields. Nested objects become `a[b]=c`. */
  form?: Record<string, unknown>;
  /** v2 endpoints take JSON. */
  json?: unknown;
  /** Act on a connected account. */
  account?: string;
  /** The same key always means the same request, so a retry can't do it twice. */
  idempotencyKey?: string;
};

function flatten(value: unknown, prefix: string, out: URLSearchParams): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
  } else if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}[${key}]` : key, out);
  } else {
    out.append(prefix, String(value));
  }
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");

  const method = options.method ?? (options.form || options.json ? "POST" : "GET");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": API_VERSION,
  };
  if (options.account) headers["Stripe-Account"] = options.account;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey.slice(0, 255);

  let url = `${host()}${path}`;
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    const params = new URLSearchParams();
    flatten(options.form, "", params);
    if (method === "GET") {
      url += `?${params.toString()}`;
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = params.toString();
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    cache: "no-store",
    // Short enough that a whole send, several calls long, fits well inside the time it holds its claim.
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; type?: string; message?: string };
  };
  if (!response.ok) {
    throw new StripeError(
      response.status,
      data.error?.code ?? data.error?.type ?? "unknown",
      data.error?.message ?? "Stripe didn't say why.",
    );
  }
  return data as T;
}

/* ------------------------------------------------------------------ */
/* A partner's account                                                 */
/* ------------------------------------------------------------------ */

type Capability = { status?: string; status_details?: { code?: string; resolution?: string }[] };

type AccountV2 = {
  id: string;
  configuration?: {
    recipient?: {
      capabilities?: { stripe_balance?: { stripe_transfers?: Capability; payouts?: Capability } };
    };
  };
  requirements?: {
    summary?: { minimum_deadline?: { status?: string } };
    entries?: unknown[];
  };
};

const INCLUDE = ["configuration.recipient", "requirements"];

/**
 * Makes the Stripe account a partner is paid through. It can only receive
 * transfers from the store; it can't take payments. The store answers for its
 * fees and for any negative balance, and the partner gets Stripe's small
 * "Express" dashboard to manage their own card.
 */
export async function createRecipientAccount(input: {
  email: string;
  name: string;
  /** Ties the Stripe account to the admin account, and stops a second one being made for them. */
  adminId: string;
  /** Live and test accounts are separate, so each gets its own. */
  live: boolean;
}): Promise<string> {
  const account = await call<AccountV2>("/v2/core/accounts", {
    json: {
      contact_email: input.email,
      display_name: input.name,
      identity: { country: "us", entity_type: "individual" },
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: {
        currency: "usd",
        responsibilities: { fees_collector: "application", losses_collector: "application" },
      },
      dashboard: "express",
      metadata: { admin_id: input.adminId },
      include: INCLUDE,
    },
    idempotencyKey: `voidszn-partner-${input.adminId}-${input.live ? "live" : "test"}`,
  });
  return account.id;
}

/**
 * Makes sure Stripe never pays a partner's balance out by itself. Money in their
 * Stripe account then only ever leaves by the instant payout this site asks for,
 * or comes back by a reversal. Stripe asks for this setting for Instant Payouts.
 */
export async function ensureManualPayouts(accountId: string): Promise<void> {
  type Settings = { payments?: { payouts?: { schedule?: { interval?: string } } } };
  const current = await call<Settings>("/v1/balance_settings", { account: accountId });
  if (current.payments?.payouts?.schedule?.interval === "manual") return;
  await call<Settings>("/v1/balance_settings", {
    account: accountId,
    form: { payments: { payouts: { schedule: { interval: "manual" } } } },
  });
}

/** A one-time link to Stripe's own form, where the partner proves who they are and adds a debit card. */
export async function createOnboardingLink(
  accountId: string,
  urls: { returnUrl: string; refreshUrl: string },
): Promise<string> {
  const link = await call<{ url: string }>("/v2/core/account_links", {
    json: {
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          return_url: urls.returnUrl,
          refresh_url: urls.refreshUrl,
        },
      },
    },
  });
  return link.url;
}

/** A one-time link into the partner's own Stripe page, where they can change their card. */
export async function createDashboardLink(accountId: string): Promise<string> {
  const link = await call<{ url: string }>(`/v1/accounts/${encodeURIComponent(accountId)}/login_links`, {
    method: "POST",
  });
  return link.url;
}

export type PayoutCard = {
  id: string;
  /** e.g. "Visa •••• 4242". Never the full number, which this site never sees. */
  label: string;
  /** Whether Stripe can pay this one out within minutes. */
  instant: boolean;
};

type ExternalAccount = {
  id: string;
  object: "card" | "bank_account";
  brand?: string;
  bank_name?: string;
  last4?: string;
  currency?: string;
  default_for_currency?: boolean;
  available_payout_methods?: string[];
};

export type PartnerAccount = {
  /** Stripe has what it needs and money can be transferred to this account. */
  canReceive: boolean;
  /** Stripe is waiting on the partner for something. */
  needsDetails: boolean;
  /** Where payouts can land, instant ones first. */
  destinations: PayoutCard[];
};

/** Where a partner's Stripe account stands right now. */
export async function getPartnerAccount(accountId: string): Promise<PartnerAccount> {
  const id = encodeURIComponent(accountId);
  const [account, external] = await Promise.all([
    call<AccountV2>(`/v2/core/accounts/${id}?${INCLUDE.map((name, index) => `include[${index}]=${name}`).join("&")}`),
    call<{ data?: ExternalAccount[] }>(`/v1/accounts/${id}/external_accounts`, {
      method: "GET",
      form: { limit: 10 },
    }),
  ]);

  const transfers = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const canReceive = transfers?.status === "active";
  const due = account.requirements?.summary?.minimum_deadline?.status;
  const destinations = (external.data ?? [])
    .filter((item) => (item.currency ?? "usd") === "usd")
    .map((item) => ({
      id: item.id,
      label: `${item.object === "card" ? (item.brand ?? "Card") : (item.bank_name ?? "Bank account")} •••• ${item.last4 ?? "????"}`,
      instant: (item.available_payout_methods ?? []).includes("instant"),
    }))
    .sort((a, b) => Number(b.instant) - Number(a.instant));

  return {
    canReceive,
    needsDetails: !canReceive || due === "currently_due" || due === "past_due",
    destinations,
  };
}

/* ------------------------------------------------------------------ */
/* Moving money                                                        */
/* ------------------------------------------------------------------ */

type Balance = {
  livemode?: boolean;
  available?: { amount: number; currency: string }[];
  instant_available?: { amount: number; currency: string }[];
};

const usd = (rows: { amount: number; currency: string }[] | undefined) =>
  (rows ?? []).filter((row) => row.currency === "usd").reduce((total, row) => total + row.amount, 0);

/** What the store's own Stripe balance can send right now, in cents, and whether this is the live account. */
export async function getStoreBalance(): Promise<{ availableCents: number; live: boolean }> {
  const balance = await call<Balance>("/v1/balance");
  return { availableCents: usd(balance.available), live: balance.livemode === true };
}

/** What a partner's Stripe account can pay out to their card this minute. */
export async function getInstantBalance(accountId: string): Promise<number> {
  const balance = await call<Balance>("/v1/balance", { account: accountId });
  return usd(balance.instant_available);
}

export type Transfer = { id: string; amount: number; reversed?: boolean };

/** Every transfer made for one cash-out carries this, so it can be found again. */
const groupFor = (payoutId: string) => `voidszn_payout_${payoutId}`;

/** Moves money from the store's Stripe balance into a partner's Stripe account. */
export const createTransfer = (input: { amountCents: number; accountId: string; payoutId: string; key: string }) =>
  call<Transfer>("/v1/transfers", {
    form: {
      amount: input.amountCents,
      currency: "usd",
      destination: input.accountId,
      description: "VOIDSZN profit share",
      transfer_group: groupFor(input.payoutId),
      metadata: { payout_id: input.payoutId },
    },
    idempotencyKey: input.key,
  });

/**
 * Every transfer already made for this cash-out and not taken back. Asked before
 * making a new one, so a try that was cut off half-way is picked up where it
 * stopped and the money is never moved twice. There should never be more than one.
 */
export async function findTransfersFor(payoutId: string): Promise<Transfer[]> {
  const list = await call<{ data?: Transfer[] }>("/v1/transfers", {
    method: "GET",
    form: { transfer_group: groupFor(payoutId), limit: 100 },
  });
  return (list.data ?? []).filter((transfer) => !transfer.reversed);
}

/** Takes a transfer back, when the payout it was for couldn't be made. */
export const reverseTransfer = (transferId: string, key: string) =>
  call<{ id: string }>(`/v1/transfers/${encodeURIComponent(transferId)}/reversals`, {
    form: { metadata: { reason: "payout_failed" } },
    idempotencyKey: key,
  });

export type StripePayout = {
  id: string;
  amount: number;
  /** pending, in_transit, paid, failed or canceled. */
  status: string;
  failure_code?: string | null;
  failure_message?: string | null;
};

/** Sends money from a partner's Stripe account to their debit card, arriving within minutes. */
export const createInstantPayout = (input: {
  amountCents: number;
  accountId: string;
  destination: string;
  payoutId: string;
  key: string;
}) =>
  call<StripePayout>("/v1/payouts", {
    account: input.accountId,
    form: {
      amount: input.amountCents,
      currency: "usd",
      method: "instant",
      destination: input.destination,
      description: "VOIDSZN profit share",
      metadata: { payout_id: input.payoutId },
    },
    idempotencyKey: input.key,
  });

/** A payout already made to the card for this cash-out and not bounced, if there is one. */
export async function findPayoutFor(accountId: string, payoutId: string): Promise<StripePayout | null> {
  const list = await call<{ data?: (StripePayout & { metadata?: Record<string, string> })[] }>("/v1/payouts", {
    method: "GET",
    account: accountId,
    form: { limit: 100 },
  });
  return (
    (list.data ?? []).find(
      (payout) => payout.metadata?.payout_id === payoutId && payout.status !== "failed" && payout.status !== "canceled",
    ) ?? null
  );
}

export const getPayout = (accountId: string, payoutId: string) =>
  call<StripePayout>(`/v1/payouts/${encodeURIComponent(payoutId)}`, { account: accountId });

/* ------------------------------------------------------------------ */
/* Events from Stripe                                                  */
/* ------------------------------------------------------------------ */

/** Whether a webhook really came from Stripe: the signature matches and it is fresh. */
export function isFromStripe(body: string, header: string | null, now: number = Date.now()): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;

  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([name]) => name === "t")?.[1];
  const signatures = parts.filter(([name]) => name === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  // Five minutes either way, so a captured request can't be replayed later.
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature ?? "")) return false;
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

let mode: { live: boolean; at: number } | null = null;

/** Whether the key is a live one or a test one. Asked of Stripe, and remembered for a few minutes. */
export async function isLiveMode(): Promise<boolean> {
  if (mode && Date.now() - mode.at < 5 * 60_000) return mode.live;
  const { live } = await getStoreBalance();
  mode = { live, at: Date.now() };
  return live;
}

/** For the deploy check: whether card payouts are switched on and the key works. Never the key itself. */
export async function getStripeStatus(): Promise<string> {
  if (!isStripeConfigured()) return "off (no key yet)";
  try {
    const { live } = await getStoreBalance();
    return live ? "on, live" : "on, test mode (practice only, no real money moves)";
  } catch (error) {
    return error instanceof StripeError ? `key not working (${error.code})` : "can't reach Stripe";
  }
}
