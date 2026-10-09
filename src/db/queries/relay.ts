import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  type Address,
  customers,
  orderEvents,
  orderItems,
  orders,
  productColors,
  productImages,
  productVariants,
  products,
  storeSettings,
} from "../schema";

/**
 * The database side of the relay store (docs/relay.md): which orders are
 * waiting to go to the printer, who is sending one right now, and what came back.
 */

/** How long a send keeps an order to itself. A send that died is given up on after this. */
export const RELAY_CLAIM_MINUTES = 10;
/** The timed job stops trying an order by itself after this many goes. A person can still send it. */
export const RELAY_MAX_ATTEMPTS = 6;

const ATTENTION = "order.attention";
const ATTENTION_RESOLVED = "order.attention_resolved";

/** Paid for and not yet placed with the printer. */
const waiting = and(
  eq(orders.status, "PAID"),
  inArray(orders.paymentStatus, ["PAID", "PARTIALLY_REFUNDED"]),
  eq(orders.fulfillmentStatus, "UNSUBMITTED"),
);

/**
 * A send that was cut off: it still carries its claim, long expired. There may be
 * a copy sitting unreleased in the relay store, so these are always finished.
 */
const unfinished = isNotNull(orders.relayClaimedAt);

const claimFree = or(
  isNull(orders.relayClaimedAt),
  lt(orders.relayClaimedAt, sql`now() - make_interval(mins => ${RELAY_CLAIM_MINUTES})`),
);

export type RelayItem = {
  productId: string | null;
  productName: string;
  colorName: string;
  size: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
};

export type ClaimedOrder = {
  id: string;
  orderNumber: string;
  /** The stamp this send holds the order under. Every write is checked against it. */
  claim: Date;
  attempts: number;
  firstTriedAt: Date;
  /** True when a send was started on this order before. The relay store may hold a copy this site never heard about. */
  triedBefore: boolean;
  externalOrderId: string | null;
  shippingName: string;
  shippingAddress: Address;
  shippingMethod: string | null;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  discountCodeText: string | null;
  phone: string | null;
  items: RelayItem[];
};

/**
 * Takes an order for sending, so nothing else sends it at the same time. Null
 * when it isn't waiting to be sent, or another send has it.
 */
export async function claimForRelay(db: Database, orderId: string): Promise<ClaimedOrder | null> {
  // The database's clock, to the millisecond, so the stamp reads back exactly and
  // is judged against the same clock that decides when a claim has run out.
  const stamp = sql`date_trunc('milliseconds', now())`;
  const [row] = await db
    .update(orders)
    .set({
      relayClaimedAt: stamp,
      relayAttempts: sql`${orders.relayAttempts} + 1`,
      relayFirstTriedAt: sql`coalesce(${orders.relayFirstTriedAt}, ${stamp})`,
      // Claiming is bookkeeping. It doesn't count as the order changing.
      updatedAt: sql`${orders.updatedAt}`,
    })
    .where(and(eq(orders.id, orderId), waiting, claimFree))
    .returning({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      claim: orders.relayClaimedAt,
      attempts: orders.relayAttempts,
      firstTriedAt: orders.relayFirstTriedAt,
      externalOrderId: orders.externalOrderId,
      shippingName: orders.shippingName,
      shippingAddress: orders.shippingAddress,
      shippingMethod: orders.shippingMethod,
      discountCents: orders.discountCents,
      shippingCents: orders.shippingCents,
      taxCents: orders.taxCents,
      discountCodeText: orders.discountCodeText,
    });
  if (!row?.claim || !row.firstTriedAt) return null;

  const items = await db
    .select({
      productId: orderItems.productId,
      productName: orderItems.productName,
      colorName: orderItems.colorName,
      size: orderItems.size,
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, row.id));
  const [customer] = await db
    .select({ phone: customers.phone })
    .from(customers)
    .where(eq(customers.id, row.customerId))
    .limit(1);
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    claim: row.claim,
    attempts: row.attempts,
    firstTriedAt: row.firstTriedAt,
    triedBefore: row.firstTriedAt.getTime() !== row.claim.getTime(),
    externalOrderId: row.externalOrderId,
    shippingName: row.shippingName,
    shippingAddress: row.shippingAddress,
    shippingMethod: row.shippingMethod,
    discountCents: row.discountCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    discountCodeText: row.discountCodeText,
    phone: customer?.phone ?? null,
    items,
  };
}

/** Why an order can't be sent right now, in words for the admin. Null if it can. */
export async function whyNotRelayable(db: Database, orderId: string): Promise<string | null> {
  const [order] = await db
    .select({
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      fulfillmentStatus: orders.fulfillmentStatus,
      busy: sql<boolean>`${orders.relayClaimedAt} is not null and ${orders.relayClaimedAt} >= now() - make_interval(mins => ${RELAY_CLAIM_MINUTES})`,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return "That order no longer exists.";
  if (order.status === "PENDING") return "This order hasn't been paid for yet.";
  if (order.status !== "PAID") return "This order has already gone to the printer, or is closed.";
  if (order.paymentStatus === "REFUNDED") return "This order was refunded in full.";
  if (order.fulfillmentStatus === "FAILED") return "The last try failed. Use “Send it again”.";
  if (order.fulfillmentStatus !== "UNSUBMITTED") return "This order has already gone to the printer.";
  if (order.busy) return "This order is being sent right now. Give it a few minutes.";
  return null;
}

type Held = Pick<ClaimedOrder, "id" | "claim">;

/**
 * Writes progress on a send, only if this send still holds the order and the
 * order is still waiting to be sent. False means the send must stop: another
 * send took it over, or a person cancelled, refunded or hand-placed the order.
 */
export async function noteRelay(
  db: Database,
  held: Held,
  change: { externalOrderId?: string | null; fulfillmentError?: string | null },
  options: { release: boolean },
): Promise<boolean> {
  const updated = await db
    .update(orders)
    .set({
      ...change,
      ...(options.release ? { relayClaimedAt: null } : {}),
      updatedAt: sql`${orders.updatedAt}`,
    })
    .where(and(eq(orders.id, held.id), eq(orders.relayClaimedAt, held.claim), waiting))
    .returning({ id: orders.id });
  return updated.length === 1;
}

/**
 * Asked just before the printer is told. Null when this send no longer holds the
 * order or the order is no longer waiting. Otherwise the address as it is now,
 * which may have been corrected since the send began.
 */
export async function heldOrder(db: Database, held: Held) {
  const [row] = await db
    .select({ shippingName: orders.shippingName, shippingAddress: orders.shippingAddress, phone: customers.phone })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.id, held.id), eq(orders.relayClaimedAt, held.claim), waiting))
    .limit(1);
  return row ?? null;
}

/** Where an order stands now, for a send that has just found it can't carry on. */
export async function orderStanding(db: Database, orderId: string) {
  const [row] = await db
    .select({
      status: orders.status,
      fulfillmentStatus: orders.fulfillmentStatus,
      fulfillmentProvider: orders.fulfillmentProvider,
      externalOrderId: orders.externalOrderId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row ?? null;
}

/** The order is with the printer. Marks it and writes it in the order's history, together. */
export async function markRelayed(db: Database, held: Held, externalOrderId: string, actor: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        status: "IN_PRODUCTION",
        fulfillmentStatus: "SUBMITTED",
        fulfillmentProvider: "PRINTMOOD",
        fulfillmentSubmittedAt: new Date(),
        fulfillmentError: null,
        externalOrderId,
        relayClaimedAt: null,
        relayCheckedAt: new Date(),
      })
      .where(and(eq(orders.id, held.id), eq(orders.relayClaimedAt, held.claim), eq(orders.status, "PAID")))
      .returning({ id: orders.id });
    if (updated.length !== 1) return false;
    await tx.insert(orderEvents).values({
      orderId: held.id,
      actor,
      type: "order.in_production",
      message: `Sent to the printer through the relay store (its order ${externalOrderId})`,
      data: { relayOrderId: externalOrderId },
    });
    return true;
  });
}

export type RelayPick =
  /** Only sends that were cut off. */
  | { kind: "unfinished" }
  /**
   * What the timed job sends by itself: cut-off sends, plus orders paid since
   * sending by itself was switched on and at least `holdMinutes` ago.
   */
  | { kind: "automatic"; since: Date; holdMinutes: number }
  /** Everything waiting, for a person who pressed the button. */
  | { kind: "everything" };

/** Orders to send, oldest first. */
export async function ordersToRelay(db: Database, limit: number, pick: RelayPick): Promise<string[]> {
  const which =
    pick.kind === "unfinished"
      ? unfinished
      : pick.kind === "everything"
        ? undefined
        : or(
            unfinished,
            and(
              // A part-refunded order may no longer want every item. A person decides.
              eq(orders.paymentStatus, "PAID"),
              // One the relay store keeps refusing isn't tried for ever. It is flagged instead.
              lt(orders.relayAttempts, RELAY_MAX_ATTEMPTS),
              // An order with no address is flagged for a person. It can't be made yet.
              sql`coalesce(${orders.shippingAddress}->>'line1', '') <> ''`,
              gte(orders.paidAt, pick.since),
              lte(orders.paidAt, sql`now() - make_interval(mins => ${pick.holdMinutes})`),
            ),
          );
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(waiting, claimFree, which))
    .orderBy(asc(orders.paidAt), asc(orders.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Orders that are with the printer through the relay and haven't shipped yet. */
export async function ordersToFollow(db: Database, limit: number) {
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      externalOrderId: orders.externalOrderId,
      submittedAt: orders.fulfillmentSubmittedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "IN_PRODUCTION"),
        eq(orders.fulfillmentProvider, "PRINTMOOD"),
        isNotNull(orders.externalOrderId),
        sql`${orders.fulfillmentSubmittedAt} > now() - interval '60 days'`,
      ),
    )
    .orderBy(sql`${orders.relayCheckedAt} asc nulls first`)
    .limit(limit);
}

export async function touchRelayChecked(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(orders)
    .set({ relayCheckedAt: new Date(), updatedAt: sql`${orders.updatedAt}` })
    .where(inArray(orders.id, ids));
}

/**
 * The printer has shipped it. True if this call is the one that marked it, so
 * the customer is emailed exactly once. Does nothing to an order a person has
 * already moved on.
 */
export async function shipFromRelay(
  db: Database,
  orderId: string,
  tracking: { carrier: string; number: string; url: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        status: "SHIPPED",
        fulfillmentStatus: "SHIPPED",
        shippedAt: new Date(),
        shippingCarrier: tracking.carrier || null,
        trackingNumber: tracking.number || null,
        trackingUrl: tracking.url || null,
        fulfillmentError: null,
        relayCheckedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "IN_PRODUCTION")))
      .returning({ id: orders.id });
    if (updated.length !== 1) return false;
    await tx.insert(orderEvents).values({
      orderId,
      actor: "relay",
      type: "order.shipped",
      message: `Shipped${tracking.carrier ? ` with ${tracking.carrier}` : ""}, tracking ${tracking.number} (from the printer)`,
    });
    return true;
  });
}

/** Raises a flag on an order for a person to look at, unless the same flag is already open. */
export async function flagRelay(db: Pick<Database, "select" | "insert">, orderId: string, message: string): Promise<void> {
  const [open] = await db
    .select({ id: orderEvents.id })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orderId, orderId),
        eq(orderEvents.type, ATTENTION),
        eq(orderEvents.message, message),
        sql`${orderEvents.createdAt} > coalesce((select max(done.created_at) from ${orderEvents} done where done.order_id = ${orderId} and done.type = ${ATTENTION_RESOLVED}), '-infinity')`,
      ),
    )
    .limit(1);
  if (open) return;
  await db.insert(orderEvents).values({ orderId, actor: "relay", type: ATTENTION, message });
}

/**
 * The order was cancelled or removed on the printer's side. It goes back to
 * "paid, not with the printer" as a failure, which the timed job never retries
 * by itself, and is flagged for a person.
 */
export async function failFromRelay(db: Database, orderId: string, message: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({ status: "PAID", fulfillmentStatus: "FAILED", fulfillmentError: message, relayCheckedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, "IN_PRODUCTION")))
      .returning({ id: orders.id });
    if (updated.length !== 1) return false;
    await tx.insert(orderEvents).values({ orderId, actor: "relay", type: "order.relay_failed", message });
    await flagRelay(tx, orderId, message);
    return true;
  });
}

/** Records on a followed order that something is off, without changing where it stands. */
export async function noteFollowProblem(db: Database, orderId: string, message: string): Promise<boolean> {
  const fresh = await db
    .update(orders)
    .set({ fulfillmentError: message, relayCheckedAt: new Date(), updatedAt: sql`${orders.updatedAt}` })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, "IN_PRODUCTION"),
        // Said once. Marking the flag as dealt with must not bring it back every half hour.
        sql`${orders.fulfillmentError} is distinct from ${message}`,
      ),
    )
    .returning({ id: orders.id });
  if (fresh.length === 1) await flagRelay(db, orderId, message);
  else await touchRelayChecked(db, [orderId]);
  return fresh.length === 1;
}

/**
 * Lets a failed order be sent again. What is known of its earlier copy is kept:
 * the next send looks at that copy first, drops it if it is gone, and takes it
 * up again if someone has brought it back, so a second one is never made beside it.
 */
export async function resetRelay(db: Database, orderNumber: string, actor: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({ fulfillmentStatus: "UNSUBMITTED", fulfillmentError: null, relayAttempts: 0 })
      .where(
        and(
          eq(orders.orderNumber, orderNumber),
          eq(orders.status, "PAID"),
          eq(orders.fulfillmentStatus, "FAILED"),
          claimFree,
        ),
      )
      .returning({ id: orders.id });
    if (updated.length !== 1) return null;
    await tx.insert(orderEvents).values({
      orderId: updated[0].id,
      actor,
      type: "order.relay_reset",
      message: "Set to be sent to the printer again",
    });
    return updated[0].id;
  });
}

/**
 * Cuts an order loose from the relay, for one a person placed with the printer
 * themselves. Nothing here follows it or sends it after this.
 */
export async function detachRelay(db: Database, orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({
      fulfillmentProvider: "MANUAL",
      externalOrderId: null,
      relayClaimedAt: null,
      relayFirstTriedAt: null,
      fulfillmentError: null,
      updatedAt: sql`${orders.updatedAt}`,
    })
    .where(eq(orders.id, orderId));
}

/** What the relay needs to know about one order when a person changes it. */
export async function relayedOrder(db: Database, orderNumber: string) {
  const [row] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      externalOrderId: orders.externalOrderId,
      firstTriedAt: orders.relayFirstTriedAt,
      shippingName: orders.shippingName,
      shippingAddress: orders.shippingAddress,
      phone: customers.phone,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Orders the relay marked as shipped in the last few days whose customer has not
 * been emailed about it: the email is sent after the order is marked, and the
 * job can be cut off between the two.
 */
export async function shippedUnmailed(db: Database): Promise<{ id: string; orderNumber: string }[]> {
  return db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(
      and(
        eq(orders.status, "SHIPPED"),
        sql`${orders.shippedAt} > now() - interval '3 days'`,
        sql`exists (select 1 from ${orderEvents} shipped where shipped.order_id = ${orders.id} and shipped.type = 'order.shipped' and shipped.actor = 'relay')`,
        sql`not exists (select 1 from ${orderEvents} told where told.order_id = ${orders.id} and told.type in ('email.order_shipped', 'email.failed') and told.created_at >= ${orders.shippedAt})`,
      ),
    )
    .limit(20);
}

/** The numbers and problem lists on the Relay screen. */
export async function relayOverview(db: Database) {
  const [counts] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${waiting})::int`,
      withPrinter: sql<number>`count(*) filter (where ${orders.status} = 'IN_PRODUCTION' and ${orders.fulfillmentProvider} = 'PRINTMOOD' and ${orders.externalOrderId} is not null)::int`,
      failed: sql<number>`count(*) filter (where ${orders.status} = 'PAID' and ${orders.fulfillmentStatus} = 'FAILED')::int`,
      shipped: sql<number>`count(*) filter (where ${orders.fulfillmentProvider} = 'PRINTMOOD' and ${orders.externalOrderId} is not null and ${orders.status} in ('SHIPPED', 'DELIVERED'))::int`,
    })
    .from(orders);
  const problems = await db
    .select({
      orderNumber: orders.orderNumber,
      error: orders.fulfillmentError,
      attempts: orders.relayAttempts,
      status: orders.status,
    })
    .from(orders)
    .where(and(isNotNull(orders.fulfillmentError), inArray(orders.status, ["PAID", "IN_PRODUCTION"])))
    .orderBy(asc(orders.paidAt))
    .limit(25);

  const [catalog] = await db
    .select({
      active: sql<number>`count(*) filter (where ${products.isActive})::int`,
      copied: sql<number>`count(*) filter (where ${products.isActive} and ${products.relaySyncedAt} is not null and ${products.externalProductId} is not null)::int`,
    })
    .from(products);
  const productProblems = await db
    .select({ id: products.id, name: products.name, error: products.relayError })
    .from(products)
    .where(and(eq(products.isActive, true), isNotNull(products.relayError)))
    .orderBy(asc(products.name))
    .limit(25);

  return {
    orders: counts ?? { waiting: 0, withPrinter: 0, failed: 0, shipped: 0 },
    problems,
    products: catalog ?? { active: 0, copied: 0 },
    productProblems,
  };
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

/** When anything about a product that the relay store holds last changed. */
const lastChanged = sql`greatest(${products.updatedAt}, coalesce((select max(v.updated_at) from ${productVariants} v where v.product_id = ${products.id}), ${products.updatedAt}))`;

/**
 * Products on sale that the relay store doesn't have yet, or has an older
 * version of. Never-copied ones first.
 */
export async function productsToSync(db: Database, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        or(isNull(products.relaySyncedAt), isNull(products.externalProductId), isNotNull(products.relayError), sql`${lastChanged} > ${products.relaySyncedAt}`),
      ),
    )
    .orderBy(sql`${products.relaySyncedAt} asc nulls first`, asc(products.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function countProductsToSync(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        or(isNull(products.relaySyncedAt), isNull(products.externalProductId), isNotNull(products.relayError), sql`${lastChanged} > ${products.relaySyncedAt}`),
      ),
    );
  return row?.value ?? 0;
}

/** One product as the relay store needs it: its name, and every option on sale. */
export async function productForRelay(db: Database, productId: string) {
  const [product] = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      shortDescription: products.shortDescription,
      externalProductId: products.externalProductId,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) return null;
  const variants = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      color: productColors.name,
      priceCents: productVariants.priceCents,
      externalVariantId: productVariants.externalVariantId,
    })
    .from(productVariants)
    .innerJoin(productColors, eq(productColors.id, productVariants.colorId))
    .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)))
    .orderBy(asc(productColors.sortOrder), asc(productVariants.sortOrder));
  const images = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(sql`${productImages.isPrimary} desc`, asc(productImages.sortOrder))
    .limit(4);
  return { ...product, variants, images: images.map((image) => image.url) };
}

/** The product is in the relay store. Remembers where, without counting as an edit. */
export async function saveProductSync(
  db: Database,
  productId: string,
  externalProductId: string,
  variantIds: { variantId: string; externalVariantId: string }[],
  /** When the copy began. An edit made while it ran is newer than this, so it is copied next time. */
  startedAt: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const link of variantIds) {
      await tx
        .update(productVariants)
        .set({ externalVariantId: link.externalVariantId, updatedAt: sql`${productVariants.updatedAt}` })
        .where(and(eq(productVariants.id, link.variantId), eq(productVariants.productId, productId)));
    }
    await tx
      .update(products)
      .set({
        externalProductId,
        relaySyncedAt: startedAt,
        relayError: null,
        updatedAt: sql`${products.updatedAt}`,
      })
      .where(eq(products.id, productId));
  });
}

export async function failProductSync(db: Database, productId: string, error: string): Promise<void> {
  await db
    .update(products)
    .set({ relayError: error.slice(0, 500), updatedAt: sql`${products.updatedAt}` })
    .where(eq(products.id, productId));
}

/** The products behind these order lines, for copying one the relay store turned out not to have. */
export async function productIdsForSkus(db: Database, skus: string[]): Promise<string[]> {
  if (skus.length === 0) return [];
  const rows = await db
    .selectDistinct({ productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.sku, skus));
  return rows.map((row) => row.productId);
}

/** The relay store's id for each of these products, as it stands now. Null for one not copied yet. */
export async function relayProductIds(db: Database, productIds: string[]): Promise<Map<string, string | null>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ id: products.id, externalProductId: products.externalProductId })
    .from(products)
    .where(inArray(products.id, productIds));
  return new Map(rows.map((row) => [row.id, row.externalProductId]));
}

/**
 * Takes the turn to run the relay's timed job. False if it ran less than
 * `minutesApart` ago, which keeps the job from being run over and over by
 * anyone who finds its address.
 */
export async function claimRelayRun(db: Database, minutesApart: number): Promise<boolean> {
  const taken = await db
    .insert(storeSettings)
    .values({ key: "relay.lastRun", value: "run" })
    .onConflictDoUpdate({
      target: storeSettings.key,
      set: { updatedAt: sql`now()` },
      setWhere: sql`${storeSettings.updatedAt} < now() - make_interval(mins => ${minutesApart})`,
    })
    .returning({ key: storeSettings.key });
  return taken.length === 1;
}
