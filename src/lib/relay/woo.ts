import "server-only";

/**
 * The relay store: a WooCommerce shop that the printer is connected to. This
 * site copies its products and paid orders there, and the printer picks them up
 * as if they had been bought in that shop. See docs/relay.md.
 *
 * This file only speaks WooCommerce's REST API (v3). What to send and when is
 * decided in `orders.ts` and `products.ts`.
 *
 * Checked against a real WooCommerce 11.2 (docs/relay.md lists what was tried):
 * - An order line that names a SKU the shop doesn't have is accepted and simply
 *   left off the order. So lines are always sent by product and variation id,
 *   and the order that comes back is checked.
 * - The `meta_key` filter on the order list is ignored. Orders are found again
 *   by listing recent ones and reading their meta here.
 */

const TIMEOUT_MS = 12_000;

/** The shop's address with no trailing slash, or null when the relay isn't set up. */
function baseUrl(): string | null {
  const raw = process.env.RELAY_WOO_URL?.trim().replace(/\/+$/, "");
  if (!raw || !process.env.RELAY_WOO_KEY || !process.env.RELAY_WOO_SECRET) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    // The keys go in a header, so only ever over HTTPS (or to this machine, for tests).
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    // A plain address only. One carrying a sign-in or a query isn't a shop's address,
    // and it is shown on the Relay screen.
    if (url.username || url.password || url.search || url.hash) return null;
    return raw;
  } catch {
    return null;
  }
}

export const isRelayConfigured = () => baseUrl() !== null;

/** The shop's address, for showing in the admin. Never the keys. */
export const relayStoreUrl = () => baseUrl();

export class WooError extends Error {
  constructor(
    /** 0 when no answer came back at all. */
    readonly status: number,
    readonly code: string,
    /** The shop's own words. Safe to show to an admin. */
    readonly detail: string,
  ) {
    super(`Relay store request failed (${status || "no answer"}: ${code})`);
  }
}

/**
 * True when the shop gave a clear "no" and so nothing was changed. Anything
 * else (a timeout, a dropped connection, a server error) may have gone through.
 */
export const isDefiniteRefusal = (error: unknown): error is WooError =>
  error instanceof WooError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;

type Query = Record<string, string | number | boolean | undefined>;

async function call<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; query?: Query } = {},
): Promise<{ data: T; totalPages: number }> {
  const base = baseUrl();
  if (!base) throw new WooError(0, "not_configured", "The relay store isn't connected yet.");

  const url = new URL(`${base}/wp-json/wc/v3${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  // Every read must be the shop's own answer, never a copy a cache kept: finding an
  // order again depends on it. A changing address gets past caches that ignore headers.
  if (method === "GET") url.searchParams.set("_fresh", String(Date.now()));
  const auth = Buffer.from(`${process.env.RELAY_WOO_KEY}:${process.env.RELAY_WOO_SECRET}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Cache-Control": "no-cache",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      // A shop that redirects (http to https, or to a login page) is misconfigured. Don't follow with the keys.
      redirect: "error",
    });
  } catch {
    throw new WooError(0, "unreachable", "The relay store didn't answer.");
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    // The answer started and never finished. Whatever was asked may have happened.
    throw new WooError(0, "unreachable", "The relay store didn't finish answering.");
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: an error page from the host, most likely.
  }
  if (!response.ok) {
    const problem = (json ?? {}) as { code?: unknown; message?: unknown };
    throw new WooError(
      response.status,
      typeof problem.code === "string" ? problem.code : "error",
      typeof problem.message === "string"
        ? problem.message.replace(/<[^>]*>/g, "").slice(0, 300)
        : `The relay store answered with an error (${response.status}).`,
    );
  }
  if (json === null) throw new WooError(response.status, "not_json", "The relay store sent back something that wasn't an answer.");
  return { data: json as T, totalPages: Number(response.headers.get("x-wp-totalpages") ?? 1) || 1 };
}

/* ------------------------------------------------------------------ */
/* The shop itself                                                     */
/* ------------------------------------------------------------------ */

export type RelayCheck =
  | { ok: true; version: string | null }
  | { ok: false; reason: string };

/** Whether the shop can be reached and the keys let this site read and write. */
export async function checkRelayStore(): Promise<RelayCheck> {
  if (!isRelayConfigured()) return { ok: false, reason: "No relay store is connected." };
  try {
    const { data } = await call<{ environment?: { version?: string } }>("GET", "/system_status", {
      query: { _fields: "environment.version" },
    });
    return { ok: true, version: data.environment?.version ?? null };
  } catch (error) {
    if (!(error instanceof WooError)) throw error;
    if (error.status === 401 || error.status === 403) {
      return { ok: false, reason: "The relay store refused the keys. They need Read/Write permission." };
    }
    if (error.status === 404) {
      return { ok: false, reason: "That address has no WooCommerce on it, or its permalinks are set to Plain." };
    }
    return { ok: false, reason: error.detail };
  }
}

/** "off (no keys yet)" or "on", for the deploy check. Never calls the shop. */
export const getRelayStatus = () => (isRelayConfigured() ? "on" : "off (no keys yet)");

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export type WooAttribute = { name: string; options: string[]; visible: boolean; variation: boolean };

export type WooProduct = {
  id: number;
  parent_id: number;
  type: string;
  status: string;
  sku: string;
  name: string;
};

export type WooVariation = {
  id: number;
  sku: string;
  regular_price: string;
  status: string;
  attributes: { name: string; option: string }[];
};

export type WooProductInput = {
  name: string;
  type: "variable";
  status: "publish";
  catalog_visibility: "hidden";
  sku: string;
  description: string;
  attributes: WooAttribute[];
  images?: { src: string }[];
};

export type WooVariationInput = {
  id?: number;
  sku: string;
  regular_price: string;
  status: "publish";
  attributes: { name: string; option: string }[];
};

/**
 * Products and variations with these SKUs. A variation comes back as itself,
 * with its product in `parent_id`.
 */
export async function findBySkus(skus: string[]): Promise<WooProduct[]> {
  const found: WooProduct[] = [];
  const unique = [...new Set(skus)];
  for (let start = 0; start < unique.length; start += 40) {
    const chunk = unique.slice(start, start + 40);
    const { data } = await call<WooProduct[]>("GET", "/products", {
      query: { sku: chunk.join(","), per_page: 100, status: "any", _fields: "id,parent_id,type,status,sku,name" },
    });
    found.push(...data);
  }
  return found;
}

/** One product, or null if the shop no longer has it. */
export async function getProduct(id: string): Promise<WooProduct | null> {
  try {
    const { data } = await call<WooProduct>("GET", `/products/${encodeURIComponent(id)}`, {
      query: { _fields: "id,parent_id,type,status,sku,name" },
    });
    return data.status === "trash" ? null : data;
  } catch (error) {
    // Only the shop saying "no such product". Any other 404 is the shop being unwell.
    if (error instanceof WooError && error.code === "woocommerce_rest_product_invalid_id") return null;
    throw error;
  }
}

export async function createProduct(input: WooProductInput): Promise<WooProduct> {
  return (await call<WooProduct>("POST", "/products", { body: input })).data;
}

export async function updateProduct(id: number, input: Partial<WooProductInput>): Promise<WooProduct> {
  return (await call<WooProduct>("PUT", `/products/${id}`, { body: input })).data;
}

export async function listVariations(productId: number): Promise<WooVariation[]> {
  const all: WooVariation[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, totalPages } = await call<WooVariation[]>("GET", `/products/${productId}/variations`, {
      query: { per_page: 100, page, status: "any", _fields: "id,sku,regular_price,status,attributes" },
    });
    all.push(...data);
    if (page >= totalPages || data.length === 0) break;
  }
  return all;
}

type BatchItem = { id?: number; sku?: string; error?: { code?: string; message?: string } };

/**
 * Creates and updates variations, up to 100 at a time. Returns the ones the
 * shop made or changed, and the reason for each one it refused.
 */
export async function saveVariations(
  productId: number,
  changes: { create: WooVariationInput[]; update: WooVariationInput[] },
): Promise<{ saved: { id: number; sku: string }[]; problems: string[] }> {
  const saved: { id: number; sku: string }[] = [];
  const problems: string[] = [];
  const queue = [
    ...changes.create.map((item) => ({ kind: "create" as const, item })),
    ...changes.update.map((item) => ({ kind: "update" as const, item })),
  ];
  for (let start = 0; start < queue.length; start += 100) {
    const chunk = queue.slice(start, start + 100);
    const body = {
      create: chunk.filter((entry) => entry.kind === "create").map((entry) => entry.item),
      update: chunk.filter((entry) => entry.kind === "update").map((entry) => entry.item),
    };
    const { data } = await call<{ create?: BatchItem[]; update?: BatchItem[] }>(
      "POST",
      `/products/${productId}/variations/batch`,
      { body },
    );
    for (const [kind, sent] of [
      ["create", body.create],
      ["update", body.update],
    ] as const) {
      (data[kind] ?? []).forEach((result, index) => {
        const sku = sent[index]?.sku ?? result.sku ?? "";
        if (result.error || !result.id) problems.push(`${sku}: ${result.error?.message ?? "not saved"}`);
        else saved.push({ id: result.id, sku });
      });
    }
  }
  return { saved, problems };
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export type WooMeta = { key: string; value: unknown };

export type WooOrder = {
  id: number;
  number: string;
  status: string;
  date_created_gmt: string;
  line_items: { product_id: number; variation_id: number; quantity: number; sku: string }[];
  meta_data: WooMeta[];
};

export type WooAddress = {
  first_name: string;
  last_name: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone?: string;
  email?: string;
};

export type WooOrderInput = {
  status: "pending";
  billing: WooAddress;
  shipping: WooAddress;
  payment_method: string;
  payment_method_title: string;
  line_items: { product_id: number; variation_id: number; quantity: number; subtotal: string; total: string }[];
  shipping_lines: { method_id: string; method_title: string; total: string }[];
  fee_lines: { name: string; total: string; tax_status: "none" }[];
  meta_data: WooMeta[];
};

const ORDER_FIELDS = "id,number,status,date_created_gmt,line_items,meta_data";

export async function createOrder(input: WooOrderInput): Promise<WooOrder> {
  return (await call<WooOrder>("POST", "/orders", { body: input })).data;
}

/**
 * One order, or null if the shop says it has no such order. A binned order comes
 * back with status "trash". Any other failure throws, including other kinds of
 * "not found" (a shop mid-update answers 404 to everything): an order must never
 * be taken for gone because the shop was unwell.
 */
export async function getOrder(id: string): Promise<WooOrder | null> {
  if (!/^\d+$/.test(id)) return null;
  try {
    return (await call<WooOrder>("GET", `/orders/${id}`, { query: { _fields: ORDER_FIELDS } })).data;
  } catch (error) {
    if (error instanceof WooError && error.code === "woocommerce_rest_shop_order_invalid_id") return null;
    throw error;
  }
}

/** Several orders by id. Ones the shop has binned or never had are simply missing from the answer. */
export async function getOrders(ids: string[]): Promise<WooOrder[]> {
  const found: WooOrder[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50).filter((id) => /^\d+$/.test(id));
    if (chunk.length === 0) continue;
    const { data } = await call<WooOrder[]>("GET", "/orders", {
      query: { include: chunk.join(","), per_page: 100, status: "any", _fields: ORDER_FIELDS },
    });
    found.push(...data);
  }
  return found;
}

export async function updateOrder(id: number, change: Record<string, unknown>): Promise<WooOrder> {
  return (await call<WooOrder>("PUT", `/orders/${id}`, { body: change, query: { _fields: ORDER_FIELDS } })).data;
}

/** Puts an order in the shop's bin. It can be restored there. */
export async function binOrder(id: number): Promise<void> {
  await call<unknown>("DELETE", `/orders/${id}`);
}

/** The most pages of orders looked through when finding an order again: 2,000 orders. */
const SCAN_PAGES = 20;

/**
 * Every order the shop made since `since`, oldest first. Used to find an order
 * again when the reply to creating it never arrived. `complete` is false when
 * there were more than could be read: the caller must then not conclude that an
 * order isn't there.
 */
export async function listOrdersSince(since: Date): Promise<{ orders: WooOrder[]; complete: boolean }> {
  const all: WooOrder[] = [];
  for (let page = 1; page <= SCAN_PAGES; page++) {
    const { data, totalPages } = await call<WooOrder[]>("GET", "/orders", {
      query: {
        after: since.toISOString(),
        dates_are_gmt: true,
        per_page: 100,
        page,
        status: "any",
        orderby: "date",
        order: "asc",
        _fields: ORDER_FIELDS,
      },
    });
    all.push(...data);
    if (page >= totalPages || data.length === 0) return { orders: all, complete: true };
  }
  return { orders: all, complete: false };
}

export async function getOrderNotes(id: number): Promise<string[]> {
  const { data } = await call<{ note?: string }[]>("GET", `/orders/${id}/notes`, { query: { _fields: "note" } });
  return data.map((entry) => entry.note ?? "").filter(Boolean);
}
