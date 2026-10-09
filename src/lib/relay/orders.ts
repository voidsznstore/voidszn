import "server-only";
import { getDb } from "@/db";
import {
  type ClaimedOrder,
  type RelayPick,
  claimForRelay,
  detachRelay,
  failFromRelay,
  flagRelay,
  heldOrder,
  markRelayed,
  noteFollowProblem,
  noteRelay,
  orderStanding,
  ordersToFollow,
  ordersToRelay,
  productIdsForSkus,
  relayProductIds,
  relayedOrder,
  shipFromRelay,
  shippedUnmailed,
  touchRelayChecked,
  whyNotRelayable,
} from "@/db/queries/relay";
import type { Address } from "@/db/schema";
import { sendOrderShipped } from "@/lib/email/order-emails";
import { siteConfig } from "@/lib/site-config";
import { syncProductToRelay } from "./products";
import { getRelaySettings, holdMinutes } from "./settings";
import { readTracking } from "./tracking";
import {
  type WooAddress,
  type WooOrder,
  type WooOrderInput,
  WooError,
  binOrder,
  createOrder,
  findBySkus,
  getOrder,
  getOrderNotes,
  getOrders,
  isDefiniteRefusal,
  isRelayConfigured,
  listOrdersSince,
  updateOrder,
} from "./woo";

/**
 * Places paid orders with the printer by way of the relay store, and brings
 * the tracking number back.
 *
 * The rule for one order: the relay store holds at most one live copy of it.
 * The copy is made unpaid ("pending"), which the printer ignores, and only
 * released to the printer ("processing") once this site has written down which
 * copy it is. A send that is cut off half-way is picked up where it stopped,
 * never started over. And a copy is only ever released for an order that is
 * still paid and waiting: one cancelled, refunded or placed by hand while its
 * send was running has its copy taken back.
 */

/** The field on the relay store's order that says which of our orders it is. */
export const ORDER_META = "_voidszn_order";

/** Statuses in which the relay store's copy exists but the printer hasn't been told. */
const HELD = new Set(["pending", "on-hold"]);
const GONE = new Set(["cancelled", "failed", "refunded", "trash"]);
/** A relayed order still not shipped after this long is flagged for a look. */
const SLOW_DAYS = 10;

const money = (cents: number) => (cents / 100).toFixed(2);

export type RelayOutcome =
  | { ok: true; relayOrderId: string }
  /** `retry` is true when the timed job will have another go by itself. */
  | { ok: false; error: string; retry: boolean };

/** Thrown inside a send to stop it with a reason a person can read. */
class Stop extends Error {}

function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/);
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
}

function wooAddress(name: string, address: Address, phone: string | null): WooAddress {
  return {
    ...splitName(name),
    address_1: address.line1,
    address_2: address.line2 ?? "",
    city: address.city,
    state: address.state,
    postcode: address.postalCode,
    country: address.country,
    ...(phone ? { phone } : {}),
  };
}

/**
 * The two addresses on the relay store's copy. Billing carries the store's own
 * email, not the customer's: the relay store sends its own order emails, and
 * the customer must only ever hear from this site.
 */
function addresses(name: string, address: Address, phone: string | null): { shipping: WooAddress; billing: WooAddress } {
  const shipping = wooAddress(name, address, phone);
  const supportEmail = siteConfig.supportEmail.includes("@") ? siteConfig.supportEmail : undefined;
  return { shipping, billing: { ...shipping, ...(supportEmail ? { email: supportEmail } : {}) } };
}

const ourOrder = (order: WooOrder) =>
  String(order.meta_data.find((entry) => entry.key === ORDER_META)?.value ?? "");

type Line = { product_id: number; variation_id: number; quantity: number };

/**
 * Where each item lives in the relay store. An item is only matched to a
 * variation that sits under the relay store's copy of its own product: a SKU
 * alone could point at an old product that once had the same name.
 */
async function resolveItems(order: ClaimedOrder): Promise<{ lines: Line[]; missing: ClaimedOrder["items"] }> {
  const db = getDb();
  const parents = await relayProductIds(db, [...new Set(order.items.flatMap((item) => (item.productId ? [item.productId] : [])))]);
  const found = new Map(
    (await findBySkus([...new Set(order.items.map((item) => item.sku))]))
      .filter((entry) => entry.status !== "trash" && entry.type === "variation" && entry.parent_id)
      .map((entry) => [entry.sku, entry]),
  );
  const lines: Line[] = [];
  const missing: ClaimedOrder["items"] = [];
  for (const item of order.items) {
    const variation = found.get(item.sku);
    const parent = item.productId ? parents.get(item.productId) : null;
    if (variation && parent && String(variation.parent_id) === parent) {
      lines.push({ product_id: variation.parent_id, variation_id: variation.id, quantity: item.quantity });
    } else {
      missing.push(item);
    }
  }
  return { lines, missing };
}

/** The relay store's copy must hold exactly the lines this order has. */
function sameLines(order: WooOrder, wanted: Line[]): boolean {
  const count = (lines: { variation_id: number; quantity: number }[]) => {
    const totals = new Map<number, number>();
    for (const line of lines) totals.set(line.variation_id, (totals.get(line.variation_id) ?? 0) + line.quantity);
    return totals;
  };
  const got = count(order.line_items);
  const want = count(wanted);
  if (got.size !== want.size) return false;
  for (const [variation, quantity] of want) if (got.get(variation) !== quantity) return false;
  return true;
}

/** What this order should look like in the relay store. Stops if the store can't hold it. */
async function buildOrder(order: ClaimedOrder): Promise<{ input: WooOrderInput; lines: Line[] }> {
  let resolved = await resolveItems(order);
  if (resolved.missing.length > 0) {
    // A product added or changed since the last copy. Copy it now and look again.
    const productIds = new Set(resolved.missing.flatMap((item) => (item.productId ? [item.productId] : [])));
    for (const productId of await productIdsForSkus(getDb(), resolved.missing.map((item) => item.sku))) productIds.add(productId);
    for (const productId of productIds) await syncProductToRelay(productId);
    resolved = await resolveItems(order);
  }
  if (resolved.missing.length > 0) {
    const names = resolved.missing.map((item) => `${item.productName} (${item.colorName}, ${item.size})`);
    throw new Stop(
      `The relay store doesn't have ${names.join(", ")}. Copy your products to it on the Relay screen, then send this order again.`,
    );
  }

  // Lines carry what was charged, in the same order as the items they came from.
  const lines = resolved.lines;
  const priced = order.items.map((item, index) => {
    const amount = money(item.unitPriceCents * item.quantity);
    return { ...lines[index], subtotal: amount, total: amount };
  });
  const fees: WooOrderInput["fee_lines"] = [];
  if (order.discountCents > 0) {
    fees.push({
      name: `Discount${order.discountCodeText ? ` ${order.discountCodeText}` : ""}`,
      total: `-${money(order.discountCents)}`,
      tax_status: "none",
    });
  }
  if (order.taxCents > 0) fees.push({ name: "Sales tax collected", total: money(order.taxCents), tax_status: "none" });

  return {
    lines,
    input: {
      // Unpaid to begin with. It is released to the printer in a second step.
      status: "pending",
      ...addresses(order.shippingName, order.shippingAddress, order.phone),
      payment_method: "other",
      payment_method_title: `Paid on ${new URL(siteConfig.url).hostname.replace(/^www\./, "")}`,
      line_items: priced,
      shipping_lines: [
        { method_id: "flat_rate", method_title: order.shippingMethod ?? "Standard shipping", total: money(order.shippingCents) },
      ],
      fee_lines: fees,
      meta_data: [{ key: ORDER_META, value: order.orderNumber }],
    },
  };
}

/**
 * Every live copy of an order in the relay store: the one written down, and any
 * that a cut-off send left behind without this site hearing of it. `complete`
 * is false when the relay store holds too many orders to be sure all were seen.
 */
async function liveCopies(order: {
  orderNumber: string;
  externalOrderId: string | null;
  firstTriedAt: Date | null;
}): Promise<{ copies: WooOrder[]; complete: boolean }> {
  const copies = new Map<number, WooOrder>();
  let complete = true;
  if (order.externalOrderId) {
    const known = await getOrder(order.externalOrderId);
    // An id is only trusted when the copy says it is this order. The relay store may have been swapped for another.
    if (known && !GONE.has(known.status) && ourOrder(known) === order.orderNumber) copies.set(known.id, known);
  }
  if (order.firstTriedAt) {
    const scan = await listOrdersSince(new Date(order.firstTriedAt.getTime() - 15 * 60 * 1000));
    complete = scan.complete;
    for (const candidate of scan.orders) {
      if (ourOrder(candidate) === order.orderNumber && !GONE.has(candidate.status)) copies.set(candidate.id, candidate);
    }
  }
  return { copies: [...copies.values()].sort((a, b) => a.id - b.id), complete };
}

/**
 * Looks for a copy of this order that an earlier, cut-off try left in the relay
 * store. Extra copies that were never released are binned.
 */
async function findEarlierCopy(order: ClaimedOrder): Promise<WooOrder | null> {
  const { copies, complete } = await liveCopies({ orderNumber: order.orderNumber, externalOrderId: null, firstTriedAt: order.firstTriedAt });
  if (copies.length === 0) {
    if (complete) return null;
    // Never make a copy on the strength of a search that couldn't see everything.
    throw new Stop(
      `The relay store has too many orders to check whether this one is already there. Look for ${order.orderNumber} in the relay store by hand before sending it again.`,
    );
  }
  const released = copies.filter((copy) => !HELD.has(copy.status));
  if (released.length > 1) {
    await flagRelay(
      getDb(),
      order.id,
      `This order is in the relay store more than once (orders ${released.map((copy) => copy.id).join(" and ")}). Cancel the extra there and in the printer's dashboard so it isn't made twice.`,
    );
  }
  // One already released wins. Otherwise the first made.
  const keep = released[0] ?? copies[0];
  for (const extra of copies) {
    if (extra.id !== keep.id && HELD.has(extra.status)) await binOrder(extra.id);
  }
  return keep;
}

/**
 * A send found it can no longer write to its order: another send has it, or a
 * person cancelled, refunded or hand-placed the order meanwhile. Whatever copy
 * this send was holding must not be left for the printer.
 */
async function giveUp(order: ClaimedOrder, copy: WooOrder | null): Promise<RelayOutcome> {
  const db = getDb();
  const lost: RelayOutcome = { ok: false, error: "This order changed while it was being sent. Refresh to see where it stands.", retry: false };
  if (!copy) return lost;
  const now = await orderStanding(db, order.id);
  const id = String(copy.id);
  // Another send finished the job with this very copy. Nothing to undo.
  if (now?.status === "IN_PRODUCTION" && now.fulfillmentProvider === "PRINTMOOD" && now.externalOrderId === id) {
    return { ok: true, relayOrderId: id };
  }
  // Still waiting, so another send holds it now and will find this copy and carry on.
  if (now?.status === "PAID" && now.fulfillmentStatus === "UNSUBMITTED") return lost;

  try {
    const current = (await getOrder(id)) ?? copy;
    if (GONE.has(current.status)) return lost;
    if (HELD.has(current.status)) {
      await binOrder(current.id);
      return lost;
    }
    if (current.status !== "completed") await updateOrder(current.id, { status: "cancelled" });
    await flagRelay(
      db,
      order.id,
      current.status === "completed"
        ? `This order was changed while it was being sent to the printer, and the printer has already finished its copy (order ${id} in the relay store). Check the printer's dashboard.`
        : `This order was changed while it was being sent to the printer. Its copy in the relay store (order ${id}) was cancelled, but the printer keeps orders it has already taken. Find order ${id} in the printer's dashboard and cancel it there so it isn't made.`,
    );
  } catch (error) {
    console.error("[relay] Could not take back a copy", error instanceof WooError ? error.code : error);
    await flagRelay(
      db,
      order.id,
      `This order was changed while it was being sent to the printer, and its copy in the relay store (order ${id}) could NOT be cancelled. Cancel it there by hand so it isn't printed.`,
    );
  }
  return lost;
}

const KEEPS_FAILING =
  "The relay store keeps failing to answer for this order. It is still tried by itself every half hour. If the relay store is working, look at this order there by hand.";

/**
 * Places one order with the printer. Safe to call twice, at the same time or
 * one after the other: the order ends up in the relay store once.
 */
export async function sendOrderToRelay(orderId: string, actor = "relay"): Promise<RelayOutcome> {
  if (!isRelayConfigured()) return { ok: false, error: "The relay store isn't connected yet.", retry: false };
  const db = getDb();
  const order = await claimForRelay(db, orderId);
  if (!order) {
    return { ok: false, error: (await whyNotRelayable(db, orderId)) ?? "This order can't be sent right now.", retry: false };
  }

  let copy: WooOrder | null = null;
  try {
    const address = order.shippingAddress;
    if (!address.line1 || !address.city || !address.postalCode || !address.country) {
      throw new Stop("This order has no full shipping address. Add it, then send the order.");
    }
    if (order.items.length === 0) throw new Stop("This order has no items.");
    const wanted = await buildOrder(order);

    // 1. Is there a copy already? One we wrote down, or one an earlier try made and never heard back about.
    if (order.externalOrderId) {
      const known = await getOrder(order.externalOrderId);
      if (known && !GONE.has(known.status) && ourOrder(known) === order.orderNumber) copy = known;
      else if (!(await noteRelay(db, order, { externalOrderId: null }, { release: false }))) return await giveUp(order, null);
    }
    if (!copy && order.triedBefore) {
      copy = await findEarlierCopy(order);
      if (copy && !(await noteRelay(db, order, { externalOrderId: String(copy.id) }, { release: false }))) return await giveUp(order, copy);
    }
    // A copy taken up again must hold exactly this order, the same as one made fresh.
    if (copy && !sameLines(copy, wanted.lines)) {
      if (HELD.has(copy.status)) {
        await binOrder(copy.id);
        copy = null;
        if (!(await noteRelay(db, order, { externalOrderId: null }, { release: false }))) return await giveUp(order, null);
      } else {
        await flagRelay(
          db,
          order.id,
          `Order ${copy.id} in the relay store is already with the printer, but its items don't match this order. Check it in the printer's dashboard.`,
        );
      }
    }

    // 2. If not, make one, unpaid, and check it holds what was ordered.
    if (!copy) {
      const made = await createOrder(wanted.input);
      if (!sameLines(made, wanted.lines)) {
        await binOrder(made.id);
        throw new Stop("The relay store didn't take every item on this order, so it was pulled back. Copy your products to it again, then send this order.");
      }
      copy = made;
      if (!(await noteRelay(db, order, { externalOrderId: String(copy.id) }, { release: false }))) return await giveUp(order, copy);
    }

    // 3. Release it to the printer, if the order is still waiting, with the address as it is now.
    if (HELD.has(copy.status)) {
      const current = await heldOrder(db, order);
      if (!current) return await giveUp(order, copy);
      copy = await updateOrder(copy.id, {
        status: "processing",
        set_paid: true,
        transaction_id: order.orderNumber,
        ...addresses(current.shippingName, current.shippingAddress, current.phone),
      });
      if (HELD.has(copy.status)) {
        throw new Stop(`The relay store kept order ${copy.id} as "${copy.status}" instead of passing it to the printer. Check the relay store, then send this order again.`);
      }
    }

    if (!(await markRelayed(db, order, String(copy.id), actor))) return await giveUp(order, copy);
    return { ok: true, relayOrderId: String(copy.id) };
  } catch (error) {
    if (error instanceof Stop || isDefiniteRefusal(error)) {
      const reason =
        error instanceof Stop
          ? error.message
          : error.status === 401 || error.status === 403
            ? "The relay store refused the keys. Check them in the hosting settings."
            : `The relay store refused this order: ${error.detail}`;
      if (!(await noteRelay(db, order, { fulfillmentError: reason }, { release: true }))) return giveUp(order, copy);
      await flagRelay(db, order.id, `Not sent to the printer. ${reason}`);
      return { ok: false, error: reason, retry: false };
    }
    // No clear answer, so a copy may or may not exist. The claim is kept: nothing tries
    // again until the relay store has had time to finish, and then step 1 looks for it.
    if (!(error instanceof WooError)) console.error("[relay] Sending an order failed", error);
    const reason = `${error instanceof WooError ? error.detail : "Something went wrong while sending."} It will be tried again by itself within the half hour.`;
    if (!(await noteRelay(db, order, { fulfillmentError: reason }, { release: false }))) return giveUp(order, copy);
    if (order.attempts >= 3) await flagRelay(db, order.id, KEEPS_FAILING);
    return { ok: false, error: reason, retry: true };
  }
}

/**
 * The timed job. Sends what is waiting if the owner has switched that on: orders
 * paid since then, once the time customers have to cancel is up. A send that was
 * cut off is always finished, switched on or not, so a copy is never left
 * half-made in the relay store.
 */
export async function sendWaitingOrders(budgetMs: number, limit = 20): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  if (!isRelayConfigured()) return result;
  const db = getDb();
  const settings = await getRelaySettings(db);
  const pick: RelayPick =
    settings.autoSend && settings.autoSince
      ? { kind: "automatic", since: new Date(settings.autoSince), holdMinutes: holdMinutes() }
      : { kind: "unfinished" };
  const started = Date.now();
  for (const id of await ordersToRelay(db, limit, pick)) {
    if (Date.now() - started >= budgetMs) break;
    try {
      const outcome = await sendOrderToRelay(id);
      if (outcome.ok) result.sent += 1;
      else result.failed += 1;
    } catch (error) {
      console.error("[relay] An order could not be sent", error);
      result.failed += 1;
    }
  }
  return result;
}

const NO_TRACKING =
  "The printer has finished this order, but no tracking number came with it. Find it in the printer's dashboard, then mark the order as shipped.";
const SLOW = `This order has been with the printer for more than ${SLOW_DAYS} days without shipping. Check it in the printer's dashboard.`;

/** Emails the customer about an order the relay marked shipped, and flags the order if that fails. */
async function tellCustomer(orderId: string, orderNumber: string): Promise<void> {
  const email = await sendOrderShipped(orderNumber);
  if (!email.sent) {
    await flagRelay(getDb(), orderId, `Marked as shipped from the printer's tracking, but the customer was not emailed: ${email.reason}`);
  }
}

/**
 * Asks the relay store how each order with the printer is getting on. One that
 * has shipped is marked shipped here with its tracking, and the customer is
 * emailed. One that was cancelled over there is flagged.
 */
export async function followRelayedOrders(budgetMs: number, limit = 50): Promise<{ shipped: number; problems: number }> {
  const result = { shipped: 0, problems: 0 };
  if (!isRelayConfigured()) return result;
  const db = getDb();
  const started = Date.now();
  const inTime = () => Date.now() - started < budgetMs;

  // First, anyone an earlier run marked as shipped and was cut off before emailing.
  for (const owed of await shippedUnmailed(db)) {
    if (!inTime()) return result;
    await tellCustomer(owed.id, owed.orderNumber);
  }

  const rows = await ordersToFollow(db, limit);
  if (rows.length === 0) return result;
  const copies = new Map((await getOrders(rows.map((row) => row.externalOrderId as string))).map((copy) => [String(copy.id), copy]));
  /** Looked at and left as they were. They go to the back of the queue. */
  const seen: string[] = [];

  for (const row of rows) {
    if (!inTime()) break;
    const id = row.externalOrderId as string;
    try {
      // The list leaves binned orders out, so one that is missing is asked for by itself.
      const copy = copies.get(id) ?? (await getOrder(id));
      if (copy && ourOrder(copy) !== row.orderNumber) {
        // Never act on an order that doesn't say it is this one.
        const fresh = await noteFollowProblem(
          db,
          row.id,
          `Order ${id} in the relay store is not this order. Was the relay store changed for another? Check the printer's dashboard before doing anything with this order.`,
        );
        if (fresh) result.problems += 1;
        continue;
      }
      if (!copy || GONE.has(copy.status)) {
        const how = !copy ? "can no longer be found" : copy.status === "trash" ? "was deleted" : `was marked ${copy.status}`;
        const failed = await failFromRelay(
          db,
          row.id,
          `This order ${how} in the relay store, so the printer is not making it. Check the printer's dashboard, then send it again or refund the customer.`,
        );
        if (failed) result.problems += 1;
        continue;
      }
      if (copy.status !== "completed") {
        const slow = row.submittedAt !== null && Date.now() - row.submittedAt.getTime() > SLOW_DAYS * 24 * 60 * 60 * 1000;
        if (slow && (await noteFollowProblem(db, row.id, SLOW))) result.problems += 1;
        else seen.push(row.id);
        continue;
      }

      const tracking = readTracking(copy.meta_data) ?? readTracking(copy.meta_data, await getOrderNotes(copy.id));
      if (!tracking) {
        if (await noteFollowProblem(db, row.id, NO_TRACKING)) result.problems += 1;
        continue;
      }
      if (await shipFromRelay(db, row.id, tracking)) {
        result.shipped += 1;
        await tellCustomer(row.id, row.orderNumber);
      }
    } catch (error) {
      // One order's trouble doesn't stop the rest, or keep it at the front of the queue.
      console.error(`[relay] Could not follow up order ${row.orderNumber}`, error instanceof WooError ? error.code : error);
      seen.push(row.id);
    }
  }
  await touchRelayChecked(db, seen);
  return result;
}

export type WithdrawReason = "cancelled" | "refunded" | "placed by hand";

/**
 * After an order is cancelled, refunded in full or placed with the printer by
 * hand: takes the relay store's copy back so it isn't made (twice). That means
 * every copy, including one a cut-off send left there without this site
 * recording it. Whatever needs a person's eye is flagged on the order. Returns
 * the same words for the admin, or "" when the relay never touched the order.
 */
export async function withdrawFromRelay(orderNumber: string, reason: WithdrawReason): Promise<string> {
  if (!isRelayConfigured()) return "";
  const db = getDb();
  const order = await relayedOrder(db, orderNumber);
  if (!order || (!order.externalOrderId && !order.firstTriedAt)) return "";

  let note = "";
  try {
    const { copies, complete } = await liveCopies(order);
    let finished = false;
    const withPrinter: number[] = [];
    for (const copy of copies) {
      if (copy.status === "completed") finished = true;
      else if (HELD.has(copy.status)) await binOrder(copy.id);
      else {
        await updateOrder(copy.id, { status: "cancelled" });
        withPrinter.push(copy.id);
      }
    }
    if (finished) {
      note = `The printer had already finished this order when it was ${reason}, so it may be on its way. Check the printer's dashboard.`;
    } else if (withPrinter.length > 0) {
      // Printmood keeps an order it has already taken in, whatever happens to it in the shop afterwards.
      note = `It was cancelled in the relay store, but the printer keeps orders it has already taken. Open the printer's dashboard, find order ${withPrinter.join(" and ")} and cancel it there (or leave it unconfirmed) so it isn't made.`;
    } else if (!complete) {
      note = `The relay store has too many orders to be sure no copy of this one is left there. Look for ${orderNumber} in the relay store and cancel it by hand.`;
    }
  } catch (error) {
    console.error("[relay] Could not cancel an order in the relay store", error instanceof WooError ? error.code : error);
    note = `It could NOT be cancelled in the relay store. Find ${orderNumber} there and cancel it by hand so it isn't printed.`;
  }
  if (reason === "placed by hand") await detachRelay(db, order.id);
  if (!note) return "";
  await flagRelay(db, order.id, note);
  return ` ${note}`;
}

/** After an address is corrected here: sends the new one to the relay store's copy. */
export async function pushAddressToRelay(orderNumber: string): Promise<string> {
  if (!isRelayConfigured()) return "";
  const db = getDb();
  const order = await relayedOrder(db, orderNumber);
  if (!order || (!order.externalOrderId && !order.firstTriedAt)) return "";

  let problem = "";
  try {
    const { copies } = await liveCopies(order);
    if (copies.length === 0) return "";
    let withPrinter = false;
    for (const copy of copies) {
      if (copy.status === "completed") {
        problem = "The printer had already finished this order when its address was changed, so the new address may be too late.";
        continue;
      }
      await updateOrder(copy.id, addresses(order.shippingName, order.shippingAddress, order.phone));
      if (!HELD.has(copy.status)) withPrinter = true;
    }
    if (!problem) {
      return withPrinter ? " The relay store has the new address too. Check the printer picked it up." : "";
    }
  } catch (error) {
    console.error("[relay] Could not update an address in the relay store", error instanceof WooError ? error.code : error);
    problem = `The relay store could NOT be given the new address. Change it on ${orderNumber} there by hand.`;
  }
  await flagRelay(db, order.id, problem);
  return ` ${problem}`;
}
