import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { getSetting, setSetting } from "@/db/queries/settings";
import { siteConfig } from "@/lib/site-config";

/**
 * Everything that talks to Square. The store needs one secret, the access token
 * (SQUARE_ACCESS_TOKEN). From that it works out on its own:
 *
 * - whether the token is a sandbox or a live one,
 * - which Square location takes the payments,
 * - the webhook that tells the store about payments, which it registers itself.
 */

const API_VERSION = "2026-09-16";

export type SquareEnvironment = "production" | "sandbox";

const HOSTS: Record<SquareEnvironment, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

/** Where Square sends payment events. Must match the registered webhook exactly. */
export const WEBHOOK_URL = `${siteConfig.url}/api/webhooks/square`;
const WEBHOOK_EVENTS = ["payment.created", "payment.updated", "refund.updated"];

export function isSquareConfigured(): boolean {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN);
}

export class SquareError extends Error {
  constructor(
    readonly status: number,
    /** Square's own error codes, e.g. UNAUTHORIZED. Safe to log and show in the health check. */
    readonly codes: string[],
    /** Which parts of the request Square objected to, e.g. "checkout_options.shipping_fee". Names only. */
    readonly fields: string[] = [],
  ) {
    super(`Square request failed (${status}${codes.length ? `: ${codes.join(", ")}` : ""})`);
  }
}

function hostFor(environment: SquareEnvironment): string {
  // Lets the automated checks run against a stand-in for Square.
  return process.env.SQUARE_API_URL ?? HOSTS[environment];
}

async function call<T>(
  environment: SquareEnvironment,
  path: string,
  init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<T> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set.");

  const response = await fetch(`${hostFor(environment)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await response.json().catch(() => ({}))) as { errors?: { code?: string; field?: string }[] };
  if (!response.ok) {
    throw new SquareError(
      response.status,
      (data.errors ?? []).map((error) => error.code ?? "UNKNOWN"),
      (data.errors ?? []).flatMap((error) => (error.field ? [error.field.slice(0, 80)] : [])),
    );
  }
  return data as T;
}

/* ------------------------------------------------------------------ */
/* Account: environment and location                                   */
/* ------------------------------------------------------------------ */

export type SquareAccount = {
  environment: SquareEnvironment;
  locationId: string;
  currency: string;
};

type Location = {
  id: string;
  status?: string;
  currency?: string;
  capabilities?: string[];
};

type Cached<T> = { value?: T; error?: unknown; at: number };
const RETRY_AFTER_MS = 60_000;

const globalForSquare = globalThis as unknown as {
  voidsznSquareAccount?: Cached<SquareAccount>;
  voidsznSquareWebhook?: Cached<string>;
  voidsznSquareWebhookRefreshedAt?: number;
  voidsznCheckoutShape?: CheckoutShape;
};

async function findAccount(): Promise<SquareAccount> {
  const forced = process.env.SQUARE_ENVIRONMENT;
  const candidates: SquareEnvironment[] =
    forced === "production" || forced === "sandbox" ? [forced] : ["production", "sandbox"];

  let lastError: unknown = new Error("No Square environment accepted the access token.");
  for (const environment of candidates) {
    try {
      const { locations = [] } = await call<{ locations?: Location[] }>(
        environment,
        "/v2/locations",
      );
      const wanted = process.env.SQUARE_LOCATION_ID;
      const active = locations.filter((location) => location.status !== "INACTIVE");
      const location = wanted
        ? active.find((candidate) => candidate.id === wanted)
        : (active.find((candidate) => candidate.capabilities?.includes("CREDIT_CARD_PROCESSING")) ??
          active[0]);
      if (!location) throw new SquareError(404, ["NO_ACTIVE_LOCATION"]);
      return { environment, locationId: location.id, currency: location.currency ?? "USD" };
    } catch (error) {
      lastError = error;
      // A token for the other environment is simply refused. Try the next one.
      if (error instanceof SquareError && error.status === 401) continue;
      throw error;
    }
  }
  throw lastError;
}

/** Which Square environment and location the access token belongs to. Looked up once. */
export async function getAccount(): Promise<SquareAccount> {
  const cached = globalForSquare.voidsznSquareAccount;
  if (cached?.value) return cached.value;
  if (cached?.error && Date.now() - cached.at < RETRY_AFTER_MS) throw cached.error;
  try {
    const value = await findAccount();
    globalForSquare.voidsznSquareAccount = { value, at: Date.now() };
    return value;
  } catch (error) {
    globalForSquare.voidsznSquareAccount = { error, at: Date.now() };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

export type CheckoutLine = {
  name: string;
  slug: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
};

/** Marks orders made by this site, so payments taken elsewhere on the same Square account are ignored. */
export const ORDER_SOURCE = "voidszn-site";

const SHIPPING_NAME = "Standard shipping";

/**
 * How the payment page is asked for:
 * - "direct": no address form, shipping as Square's own shipping fee.
 * - "charges": no address form, shipping as a charge on the order.
 * - "square-asks": Square's page asks for the address.
 */
export type CheckoutShape = "direct" | "charges" | "square-asks";
/** A way of asking that Square turned down, and which parts it named. No customer details. */
export type CheckoutRefusal = { shape: CheckoutShape; codes: string[]; fields: string[] };

/** Where the health check finds how the last payment page went. */
export const CHECKOUT_NOTE_KEY = "checkout.lastStart";
export type CheckoutNote = { at: string; outcome: string; refusals: CheckoutRefusal[] };

/** Names the sales tax charge on an order, so it can be told apart from shipping when the order is read back. */
export const TAX_CHARGE_UID = "sales-tax";

/**
 * Creates the Square order and its hosted payment page. Returns the page to send
 * the customer to and the id of the order they will be paying.
 */
export async function createCheckout(input: {
  lines: CheckoutLine[];
  /** Zero when a code makes shipping free. */
  shippingCents: number;
  /**
   * Sales tax, already worked out for the delivery address. It goes on the order
   * as a fixed amount under its own name, so the customer pays exactly the figure
   * the checkout page showed. (Square's own tax lines are percentages it rounds
   * its own way.)
   */
  tax?: { cents: number; name: string } | null;
  /**
   * The delivery address, when the store has already taken it. The payment page
   * is then asked not to take another one, or the tax could be for the wrong
   * place. Left out, Square asks for the address itself.
   */
  shipTo?: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string } | null;
  /** A discount code that has already been checked and priced on the server. */
  discount?: { id: string; code: string; label: string; discountCents: number } | null;
  /** Ticked "email me new designs and offers". Acted on only once they have paid. */
  wantsMarketing?: boolean;
  /** Fills in the email on the payment page, so the customer doesn't type it twice. */
  buyerEmail?: string | null;
  redirectUrl: string;
}): Promise<{ url: string; orderId: string; shape: CheckoutShape; refusals: CheckoutRefusal[] }> {
  const account = await getAccount();
  const money = (amount: number) => ({ amount, currency: account.currency });
  const shipTo = input.shipTo ?? null;

  const body = (shape: CheckoutShape, withWallets: boolean) => {
    // Fixed amounts added to the order under their own names, not themselves taxed.
    const charges = [
      ...(shape === "charges" && input.shippingCents > 0
        ? [
            {
              uid: "shipping",
              name: SHIPPING_NAME,
              amount_money: money(input.shippingCents),
              calculation_phase: "SUBTOTAL_PHASE",
              taxable: false,
            },
          ]
        : []),
      ...(input.tax && input.tax.cents > 0
        ? [
            {
              uid: TAX_CHARGE_UID,
              name: input.tax.name,
              amount_money: money(input.tax.cents),
              calculation_phase: "TOTAL_PHASE",
              taxable: false,
            },
          ]
        : []),
    ];
    const prefill = {
      ...(input.buyerEmail ? { buyer_email: input.buyerEmail } : {}),
      // Only when Square is asking for the address anyway: ours, filled in.
      ...(shape === "square-asks" && shipTo
        ? {
            buyer_address: {
              address_line_1: shipTo.line1,
              ...(shipTo.line2 ? { address_line_2: shipTo.line2 } : {}),
              locality: shipTo.city,
              administrative_district_level_1: shipTo.state,
              postal_code: shipTo.postalCode,
              country: shipTo.country,
            },
          }
        : {}),
    };
    return {
      idempotency_key: randomUUID(),
      order: {
        location_id: account.locationId,
        metadata: {
          source: ORDER_SOURCE,
          // Carried on the order so the code is known when the payment comes back. The
          // id survives the code being renamed in the meantime.
          ...(input.discount
            ? { discount_code: input.discount.code, discount_id: input.discount.id }
            : {}),
          ...(input.wantsMarketing ? { marketing: "yes" } : {}),
        },
        line_items: input.lines.map((line) => ({
          name: line.name,
          variation_name: `${line.color} / ${line.size}`,
          quantity: String(line.quantity),
          base_price_money: money(line.unitPriceCents),
          metadata: { slug: line.slug, color: line.color, size: line.size },
        })),
        // Taken off the items, never off shipping.
        ...(input.discount && input.discount.discountCents > 0
          ? {
              discounts: [
                {
                  uid: "code",
                  name: `${input.discount.code} (${input.discount.label})`,
                  amount_money: money(input.discount.discountCents),
                  scope: "ORDER",
                },
              ],
            }
          : {}),
        ...(charges.length > 0 ? { service_charges: charges } : {}),
      },
      ...(Object.keys(prefill).length > 0 ? { pre_populated_data: prefill } : {}),
      checkout_options: {
        redirect_url: input.redirectUrl,
        ask_for_shipping_address: shape === "square-asks",
        ...(shape !== "charges" && input.shippingCents > 0
          ? { shipping_fee: { name: SHIPPING_NAME, charge: money(input.shippingCents) } }
          : {}),
        merchant_support_email: siteConfig.supportEmail,
        allow_tipping: false,
        enable_coupon: false,
        enable_loyalty: false,
        ...(withWallets
          ? { accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: true } }
          : {}),
      },
    };
  };

  type Created = { payment_link?: { url?: string; order_id?: string } };
  const create = async (shape: CheckoutShape): Promise<Created> => {
    try {
      return await call<Created>(account.environment, "/v2/online-checkout/payment-links", {
        method: "POST",
        body: body(shape, true),
      });
    } catch (error) {
      // If the account can't offer a wallet, still let people pay by card.
      if (!(error instanceof SquareError) || error.status !== 400) throw error;
      return await call<Created>(account.environment, "/v2/online-checkout/payment-links", {
        method: "POST",
        body: body(shape, false),
      });
    }
  };

  // With our own address in hand, the payment page shouldn't ask for one. Square
  // doesn't say which ways of asking for that it accepts, so they are tried in
  // order of preference, starting with the one that last worked. The last is the
  // long-standing one, where Square asks for the address (with ours filled in).
  const preferred: CheckoutShape[] = shipTo ? ["direct", "charges", "square-asks"] : ["square-asks"];
  const known = globalForSquare.voidsznCheckoutShape;
  const shapes = known && preferred.includes(known) ? [known, ...preferred.filter((shape) => shape !== known)] : preferred;

  const refusals: CheckoutRefusal[] = [];
  let created: Created | null = null;
  let used: CheckoutShape = shapes[0];
  let lastError: unknown = null;
  for (const shape of shapes) {
    try {
      created = await create(shape);
      used = shape;
      break;
    } catch (error) {
      // Anything but "this request is not acceptable" is not a reason to try another way.
      if (!(error instanceof SquareError) || error.status !== 400) throw error;
      refusals.push({ shape, codes: error.codes, fields: error.fields });
      lastError = error;
      console.error(`[square] Payment page refused (${shape})`, error.codes, error.fields);
    }
  }
  if (!created) throw lastError;
  if (shipTo) globalForSquare.voidsznCheckoutShape = used;

  const url = created.payment_link?.url;
  const orderId = created.payment_link?.order_id;
  if (!url || !orderId) throw new Error("Square did not return a payment page.");
  return { url, orderId, shape: used, refusals };
}

/* ------------------------------------------------------------------ */
/* Reading orders and payments back                                    */
/* ------------------------------------------------------------------ */

type Money = { amount?: number; currency?: string };
type SquareAddress = {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  administrative_district_level_1?: string;
  postal_code?: string;
  country?: string;
  first_name?: string;
  last_name?: string;
};

export type SquarePayment = {
  id: string;
  status?: string;
  order_id?: string;
  location_id?: string;
  amount_money?: Money;
  total_money?: Money;
  buyer_email_address?: string;
  shipping_address?: SquareAddress;
  receipt_url?: string;
  /**
   * What Square took for handling the payment, and any later corrections. It is
   * filled in a little after the payment completes, so it can be missing at first.
   */
  processing_fee?: { type?: string; amount_money?: Money }[];
};

export type SquareOrder = {
  id: string;
  location_id?: string;
  metadata?: Record<string, string>;
  line_items?: {
    name?: string;
    quantity?: string;
    base_price_money?: Money;
    metadata?: Record<string, string>;
  }[];
  fulfillments?: {
    type?: string;
    shipment_details?: {
      recipient?: {
        display_name?: string;
        email_address?: string;
        phone_number?: string;
        address?: SquareAddress;
      };
    };
  }[];
  tenders?: { id?: string; payment_id?: string }[];
  /** Shipping, and sales tax when the store charged it. */
  service_charges?: {
    uid?: string;
    name?: string;
    amount_money?: Money;
    applied_money?: Money;
    total_money?: Money;
  }[];
  total_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_service_charge_money?: Money;
};

const SQUARE_ID = /^[A-Za-z0-9_-]{8,192}$/;
export const isSquareId = (value: unknown): value is string =>
  typeof value === "string" && SQUARE_ID.test(value);

export async function getPayment(paymentId: string): Promise<SquarePayment | null> {
  const account = await getAccount();
  const { payment } = await call<{ payment?: SquarePayment }>(
    account.environment,
    `/v2/payments/${encodeURIComponent(paymentId)}`,
  );
  return payment ?? null;
}

export async function getOrder(orderId: string): Promise<SquareOrder | null> {
  const account = await getAccount();
  try {
    const { order } = await call<{ order?: SquareOrder }>(
      account.environment,
      `/v2/orders/${encodeURIComponent(orderId)}`,
    );
    return order ?? null;
  } catch (error) {
    if (error instanceof SquareError && error.status === 404) return null;
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

export type SquareRefund = { id: string; status?: string; payment_id?: string; amount_money?: Money };

/**
 * Sends money back for a payment. `idempotencyKey` identifies this one refund: if
 * the same request is sent twice, Square refunds once and answers the same way.
 */
export async function refundPayment(input: {
  paymentId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<SquareRefund> {
  const account = await getAccount();
  const { refund } = await call<{ refund?: SquareRefund }>(account.environment, "/v2/refunds", {
    method: "POST",
    body: {
      idempotency_key: input.idempotencyKey,
      payment_id: input.paymentId,
      amount_money: { amount: input.amountCents, currency: account.currency },
      ...(input.reason ? { reason: input.reason.slice(0, 192) } : {}),
    },
  });
  if (!refund) throw new Error("Square did not return a refund.");
  return refund;
}

export async function getRefund(refundId: string): Promise<SquareRefund | null> {
  const account = await getAccount();
  const { refund } = await call<{ refund?: SquareRefund }>(
    account.environment,
    `/v2/refunds/${encodeURIComponent(refundId)}`,
  );
  return refund ?? null;
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

type Subscription = {
  id: string;
  enabled?: boolean;
  event_types?: string[];
  notification_url?: string;
  signature_key?: string;
};

async function registerWebhook(environment: SquareEnvironment): Promise<Subscription> {
  const { subscriptions = [] } = await call<{ subscriptions?: Subscription[] }>(
    environment,
    "/v2/webhooks/subscriptions?include_disabled=true",
  );
  const existing = subscriptions.find((item) => item.notification_url === WEBHOOK_URL);

  if (!existing) {
    const { subscription } = await call<{ subscription: Subscription }>(
      environment,
      "/v2/webhooks/subscriptions",
      {
        method: "POST",
        body: {
          // The same key every time, so two requests at once can't make two webhooks.
          // Square allows 45 characters here.
          idempotency_key: createHash("sha256")
            .update(`voidszn:${WEBHOOK_URL}`)
            .digest("hex")
            .slice(0, 32),
          subscription: {
            name: "VOIDSZN store",
            event_types: WEBHOOK_EVENTS,
            notification_url: WEBHOOK_URL,
            api_version: API_VERSION,
          },
        },
      },
    );
    return subscription;
  }

  const missingEvents = WEBHOOK_EVENTS.some((type) => !existing.event_types?.includes(type));
  if (existing.enabled === false || missingEvents) {
    await call(environment, `/v2/webhooks/subscriptions/${existing.id}`, {
      method: "PUT",
      body: {
        subscription: {
          enabled: true,
          event_types: [...new Set([...(existing.event_types ?? []), ...WEBHOOK_EVENTS])],
        },
      },
    });
  }
  return readWebhook(environment, existing.id);
}

async function readWebhook(environment: SquareEnvironment, id: string): Promise<Subscription> {
  const { subscription } = await call<{ subscription: Subscription }>(
    environment,
    `/v2/webhooks/subscriptions/${id}`,
  );
  return subscription;
}

const settingKey = (environment: SquareEnvironment) => `square.webhook.${environment}`;

/**
 * The key that proves a webhook really came from Square. Registers the webhook
 * with Square the first time it is needed and remembers the key in the database.
 *
 * `refresh` re-reads the key from Square, for when it has been changed there.
 */
export async function getWebhookKey(options: { refresh?: boolean } = {}): Promise<string> {
  const fromEnv = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (fromEnv) return fromEnv;

  const cached = globalForSquare.voidsznSquareWebhook;
  if (!options.refresh) {
    if (cached?.value) return cached.value;
    if (cached?.error && Date.now() - cached.at < RETRY_AFTER_MS) throw cached.error;
  }

  try {
    const { environment } = await getAccount();
    const db = getDb();
    const saved = options.refresh ? null : await getSetting(db, settingKey(environment));
    const known = saved ? (JSON.parse(saved) as { key?: string; events?: string[] }) : null;
    // Register again when the store starts listening for a kind of event it didn't before.
    const upToDate = WEBHOOK_EVENTS.every((type) => known?.events?.includes(type));
    let key = upToDate ? known?.key : undefined;

    if (!key) {
      const subscription = await registerWebhook(environment);
      key = subscription.signature_key;
      if (!key) throw new Error("Square did not return a webhook signature key.");
      await setSetting(
        db,
        settingKey(environment),
        JSON.stringify({ id: subscription.id, key, events: WEBHOOK_EVENTS }),
      );
    }

    globalForSquare.voidsznSquareWebhook = { value: key, at: Date.now() };
    return key;
  } catch (error) {
    if (!options.refresh) globalForSquare.voidsznSquareWebhook = { error, at: Date.now() };
    throw error;
  }
}

function signatureMatches(body: string, signature: string, key: string): boolean {
  const expected = createHmac("sha256", key).update(WEBHOOK_URL + body).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const REFRESH_AT_MOST_EVERY_MS = 5 * 60_000;

/** True when the request body was signed by Square for this store's webhook. */
export async function isFromSquare(body: string, signature: string): Promise<boolean> {
  if (signatureMatches(body, signature, await getWebhookKey())) return true;

  // The key may have been changed in Square. Check again, but not on every bad request.
  const last = globalForSquare.voidsznSquareWebhookRefreshedAt ?? 0;
  if (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || Date.now() - last < REFRESH_AT_MOST_EVERY_MS) {
    return false;
  }
  globalForSquare.voidsznSquareWebhookRefreshedAt = Date.now();
  try {
    return signatureMatches(body, signature, await getWebhookKey({ refresh: true }));
  } catch (error) {
    console.error("[square] Could not re-read the webhook key", error);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Status for the health check                                         */
/* ------------------------------------------------------------------ */

const describe = (error: unknown) =>
  error instanceof SquareError
    ? `error: ${error.codes.join(", ") || error.status}`
    : "error: could not reach Square or the database";

/** A secret-free summary of the payment setup. Also registers the webhook if it is missing. */
export async function getSquareStatus(): Promise<{ payments: string; webhook: string }> {
  if (!isSquareConfigured()) return { payments: "not configured", webhook: "not configured" };

  let payments: string;
  try {
    payments = (await getAccount()).environment;
  } catch (error) {
    return { payments: describe(error), webhook: "not checked" };
  }

  try {
    await getWebhookKey();
    return { payments, webhook: "ok" };
  } catch (error) {
    console.error("[square] Webhook is not set up", error);
    return { payments, webhook: describe(error) };
  }
}
