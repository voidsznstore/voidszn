/**
 * Checks the relay against a real WooCommerce shop and a real database.
 *
 * Run: DATABASE_URL=... RELAY_WOO_URL=http://127.0.0.1:4080 RELAY_WOO_KEY=ck_... RELAY_WOO_SECRET=cs_... npm run test:relay
 *
 * It makes its own products and orders (named RELAYTEST...) in both places and
 * leaves the shop's copies behind, binned.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  customers,
  orderEvents,
  orderItems,
  orders,
  productColors,
  productImages,
  productVariants,
  products,
  storeSettings,
} from "../src/db/schema";
import { cancelOrder, markInProduction } from "../src/db/queries/admin-orders";
import {
  claimForRelay,
  claimRelayRun,
  failFromRelay,
  noteRelay,
  ordersToRelay,
  relayOverview,
  resetRelay,
  shipFromRelay,
} from "../src/db/queries/relay";
import { setSetting } from "../src/db/queries/settings";
import {
  ORDER_META,
  followRelayedOrders,
  pushAddressToRelay,
  sendOrderToRelay,
  sendWaitingOrders,
  withdrawFromRelay,
} from "../src/lib/relay/orders";
import { parentSku, syncCatalogToRelay, syncProductToRelay } from "../src/lib/relay/products";
import { setAutoSend } from "../src/lib/relay/settings";
import { readTracking } from "../src/lib/relay/tracking";
import {
  binOrder,
  checkRelayStore,
  findBySkus,
  getOrder,
  isDefiniteRefusal,
  listOrdersSince,
  listVariations,
} from "../src/lib/relay/woo";

let passed = 0;
const ok = (label: string) => {
  passed += 1;
  console.log(`  ok  ${label}`);
};

const db = getDb();
const run = randomUUID().slice(0, 6).toUpperCase();
const slug = `relaytest-${run.toLowerCase()}`;
const sku = (color: string, size: string) => `RELAYTEST-${run}-${color}-${size}`.toUpperCase();

/** The parts of the shop's order this test reads. */
type ShopOrder = {
  status: string;
  date_paid: string | null;
  transaction_id: string;
  total: string;
  line_items: { sku: string; quantity: number; total: string }[];
  shipping: Record<string, string>;
  billing: Record<string, string>;
};

/** Talks to the shop directly, for setting up what the printer would do. */
async function shop(method: string, path: string, body?: unknown) {
  const auth = Buffer.from(`${process.env.RELAY_WOO_KEY}:${process.env.RELAY_WOO_SECRET}`).toString("base64");
  const response = await fetch(`${process.env.RELAY_WOO_URL}/wp-json/wc/v3${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

async function makeProduct(): Promise<{ productId: string; variants: { id: string; sku: string; color: string; size: string }[] }> {
  const [product] = await db
    .insert(products)
    .values({ name: `Relay Test Tee ${run}`, slug, priceCents: 3400, isActive: true, shortDescription: "A test tee" })
    .returning({ id: products.id });
  const colors = await db
    .insert(productColors)
    .values([
      { productId: product.id, name: "Black", hex: "#000000", sortOrder: 0 },
      { productId: product.id, name: "Olive", hex: "#556B2F", sortOrder: 1 },
    ])
    .returning({ id: productColors.id, name: productColors.name });
  const rows = colors.flatMap((color, c) =>
    ["M", "L"].map((size, s) => ({
      productId: product.id,
      colorId: color.id,
      size,
      sku: sku(color.name, size),
      priceCents: 3400 + c * 200,
      costCents: 1200,
      sortOrder: s,
    })),
  );
  const variants = await db.insert(productVariants).values(rows).returning({ id: productVariants.id, sku: productVariants.sku, size: productVariants.size, colorId: productVariants.colorId });
  // A photo the shop can't fetch: the product must still go over.
  await db.insert(productImages).values({ productId: product.id, url: "https://unreachable.invalid/tee.png", isPrimary: true });
  return {
    productId: product.id,
    variants: variants.map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size, color: colors.find((color) => color.id === variant.colorId)?.name ?? "" })),
  };
}

let orderCount = 0;
async function makeOrder(
  lines: { sku: string; color: string; size: string; quantity: number; variantId?: string; productId?: string }[],
  overrides: Partial<typeof orders.$inferInsert> = {},
): Promise<{ id: string; orderNumber: string }> {
  orderCount += 1;
  const email = `relaytest-${run.toLowerCase()}-${orderCount}@example.com`;
  const [customer] = await db.insert(customers).values({ email, name: "Sam Buyer", phone: "4075550100" }).returning({ id: customers.id });
  const subtotal = lines.reduce((total, line) => total + 3400 * line.quantity, 0);
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `VS-RT${run}${orderCount}`.slice(0, 15),
      customerId: customer.id,
      email,
      status: "PAID",
      paymentStatus: "PAID",
      paidAt: new Date(),
      subtotalCents: subtotal,
      discountCents: 340,
      shippingCents: 449,
      totalCents: subtotal - 340 + 449,
      discountCodeText: "WELCOME10",
      shippingName: "Sam Q Buyer",
      shippingAddress: { line1: "1 Test St", line2: "Apt 2", city: "Orlando", state: "FL", postalCode: "32801", country: "US" },
      shippingMethod: "Standard shipping",
      ...overrides,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber });
  await db.insert(orderItems).values(
    lines.map((line) => ({
      orderId: order.id,
      productId: line.productId ?? null,
      variantId: line.variantId ?? null,
      productName: `Relay Test Tee ${run}`,
      colorName: line.color,
      size: line.size,
      sku: line.sku,
      unitPriceCents: 3400,
      quantity: line.quantity,
    })),
  );
  return order;
}

const state = async (id: string) => {
  const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return row;
};
/** Every copy of an order in the shop that isn't binned or cancelled. */
const copiesOf = async (orderNumber: string) =>
  (await listOrdersSince(new Date(Date.now() - 60 * 60 * 1000))).orders.filter(
    (copy) =>
      copy.meta_data.some((entry) => entry.key === ORDER_META && entry.value === orderNumber) &&
      !["cancelled", "trash", "failed", "refunded"].includes(copy.status),
  );
const flagsOn = async (orderId: string) =>
  (
    await db
      .select({ message: orderEvents.message })
      .from(orderEvents)
      .where(sql`${orderEvents.orderId} = ${orderId} and ${orderEvents.type} = 'order.attention'`)
  ).map((flag) => flag.message ?? "");
const expireClaim = (orderId: string) =>
  db.update(orders).set({ relayClaimedAt: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(orders.id, orderId));
/** Sending by itself, on since a given time. */
const autoSince = (since: Date | null) =>
  setSetting(db, "relay.settings", JSON.stringify({ autoSend: since !== null, autoSince: since?.toISOString() ?? null }));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
const BUDGET = 60_000;

async function main() {
  /* ---- Reading tracking, which needs no shop ---- */
  assert.deepEqual(
    readTracking([{ key: "_wc_shipment_tracking_items", value: [{ tracking_provider: "usps", tracking_number: "9400 1118 9922 3100 0012 34" }] }]),
    { carrier: "USPS", number: "9400111899223100001234", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223100001234" },
  );
  assert.deepEqual(
    readTracking([
      { key: "_tracking_number", value: "1Z999AA10123456784" },
      { key: "_tracking_url", value: "https://track.example.com/1Z999AA10123456784" },
      { key: "_shipping_carrier", value: "UPS Ground" },
    ]),
    { carrier: "UPS", number: "1Z999AA10123456784", url: "https://track.example.com/1Z999AA10123456784" },
  );
  assert.equal(readTracking([{ key: "_tracking_url", value: "javascript:alert(1)" }, { key: "_tracking_number", value: "12345678" }])?.url, "");
  assert.deepEqual(readTracking([], ["Order status changed.", "Shipped via FedEx. Tracking number: 794644790138"]), {
    carrier: "FedEx",
    number: "794644790138",
    url: "https://www.fedex.com/fedextrack/?trknbr=794644790138",
  });
  assert.equal(readTracking([], ["Tracking information will follow shortly."]), null);
  assert.equal(readTracking([{ key: "_wc_shipment_tracking_items", value: "nonsense" }, { key: "_billing_phone", value: "4075550100" }]), null);
  ok("tracking is read from the plugins' list, loose fields or a note, and nothing unsafe is kept");

  /* ---- The shop itself ---- */
  const check = await checkRelayStore();
  assert.equal(check.ok, true);
  const realKey = process.env.RELAY_WOO_KEY;
  process.env.RELAY_WOO_KEY = "ck_wrong";
  const refused = await checkRelayStore();
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.reason, /refused the keys/);
  await assert.rejects(listOrdersSince(new Date()), (error) => isDefiniteRefusal(error));
  process.env.RELAY_WOO_KEY = realKey;
  assert.equal(await getOrder("999999999"), null);
  ok("the shop answers, and wrong keys are refused in plain words");

  /* ---- Products ---- */
  const { productId, variants } = await makeProduct();
  assert.deepEqual(await syncProductToRelay(productId), { ok: true });
  const [parent] = await findBySkus([parentSku(slug)]);
  assert.equal(parent.type, "variable");
  let remote = await listVariations(parent.id);
  assert.deepEqual(remote.map((variation) => variation.sku).sort(), variants.map((variant) => variant.sku).sort());
  assert.equal(remote.find((variation) => variation.sku === sku("Olive", "L"))?.regular_price, "36.00");
  const [saved] = await db.select().from(products).where(eq(products.id, productId));
  assert.equal(saved.externalProductId, String(parent.id));
  assert.ok(saved.relaySyncedAt && saved.relayError === null);
  const linked = await db.select({ ext: productVariants.externalVariantId }).from(productVariants).where(eq(productVariants.productId, productId));
  assert.ok(linked.every((row) => row.ext && /^\d+$/.test(row.ext)));
  ok("a product is copied with every size under its own SKU, even when the shop can't fetch its photo");

  // Nothing has changed, so a second run copies nothing and makes no duplicates.
  const quiet = await syncCatalogToRelay(20_000);
  assert.equal((await findBySkus([parentSku(slug)])).length, 1);
  assert.equal((await listVariations(parent.id)).length, 4);
  // A price change and a new size are picked up.
  await db.update(productVariants).set({ priceCents: 3900 }).where(eq(productVariants.sku, sku("Black", "M")));
  const [black] = await db.select({ id: productColors.id }).from(productColors).where(sql`${productColors.productId} = ${productId} and ${productColors.name} = 'Black'`);
  await db.insert(productVariants).values({ productId, colorId: black.id, size: "XL", sku: sku("Black", "XL"), priceCents: 3600, sortOrder: 2 });
  const again = await syncCatalogToRelay(20_000);
  assert.ok(again.copied >= 1);
  remote = await listVariations(parent.id);
  assert.equal(remote.length, 5);
  assert.equal(remote.find((variation) => variation.sku === sku("Black", "M"))?.regular_price, "39.00");
  assert.equal((await findBySkus([parentSku(slug)])).length, 1);
  assert.equal((await syncCatalogToRelay(20_000)).copied, 0);
  void quiet;
  ok("copying again changes only what changed: a new price, a new size, never a second product");

  /* ---- An order, start to finish ---- */
  const line = (color: string, size: string, quantity: number) => ({ sku: sku(color, size), color, size, quantity, productId });
  const first = await makeOrder([line("Olive", "L", 2), line("Black", "M", 1)]);
  const sent = await sendOrderToRelay(first.id, "test");
  assert.equal(sent.ok, true);
  let row = await state(first.id);
  assert.equal(`${row.status}/${row.fulfillmentStatus}/${row.fulfillmentProvider}`, "IN_PRODUCTION/SUBMITTED/PRINTMOOD");
  assert.equal(row.relayClaimedAt, null);
  assert.equal(row.fulfillmentError, null);
  const copy = (await shop("GET", `/orders/${row.externalOrderId}`)) as ShopOrder;
  assert.equal(copy.status, "processing");
  assert.ok(copy.date_paid);
  assert.equal(copy.transaction_id, first.orderNumber);
  assert.deepEqual(
    copy.line_items.map((item) => `${item.sku}x${item.quantity}=${item.total}`).sort(),
    [`${sku("Black", "M")}x1=34.00`, `${sku("Olive", "L")}x2=68.00`].sort(),
  );
  assert.equal(copy.total, "103.09"); // 102.00 items - 3.40 discount + 4.49 shipping
  assert.equal(`${copy.shipping.first_name}|${copy.shipping.last_name}|${copy.shipping.address_1}|${copy.shipping.address_2}|${copy.shipping.city}|${copy.shipping.state}|${copy.shipping.postcode}|${copy.shipping.country}|${copy.shipping.phone}`, "Sam|Q Buyer|1 Test St|Apt 2|Orlando|FL|32801|US|4075550100");
  // The customer's own email never goes to the relay store.
  assert.ok(!JSON.stringify(copy).includes("relaytest-"));
  assert.equal(copy.billing.email, "support@voidszn.com");
  const events = await db.select({ type: orderEvents.type, message: orderEvents.message }).from(orderEvents).where(eq(orderEvents.orderId, first.id));
  assert.ok(events.some((event) => event.type === "order.in_production" && event.message?.includes(String(row.externalOrderId))));
  ok("a paid order is placed in the shop once, released to the printer, with the right items, totals and address");

  // Sending it again does nothing.
  const twice = await sendOrderToRelay(first.id, "test");
  assert.equal(twice.ok, false);
  assert.equal((await copiesOf(first.orderNumber)).length, 1);
  ok("sending the same order again is refused and makes no second copy");

  // Two sends at the very same moment: one copy.
  const race = await makeOrder([line("Black", "L", 1)]);
  const both = await Promise.all([sendOrderToRelay(race.id, "a"), sendOrderToRelay(race.id, "b")]);
  assert.equal(both.filter((outcome) => outcome.ok).length, 1);
  assert.equal((await copiesOf(race.orderNumber)).length, 1);
  ok("two sends at the same moment place it once");

  /* ---- A send cut off half-way ---- */
  // The shop made the copy but the reply was lost: this site knows nothing of it.
  const lostReply = await makeOrder([line("Olive", "M", 1)]);
  const held = await claimForRelay(db, lostReply.id);
  assert.ok(held && !held.triedBefore);
  const stray = (await shop("POST", "/orders", {
    status: "pending",
    shipping: { first_name: "Old", last_name: "Name", address_1: "0 Stale St", city: "Tampa", state: "FL", postcode: "33601", country: "US" },
    line_items: [{ sku: sku("Olive", "M"), quantity: 1 }],
    meta_data: [{ key: ORDER_META, value: lostReply.orderNumber }],
  })) as { id: number };
  const strayTwo = (await shop("POST", "/orders", {
    status: "pending",
    line_items: [{ sku: sku("Olive", "M"), quantity: 1 }],
    meta_data: [{ key: ORDER_META, value: lostReply.orderNumber }],
  })) as { id: number };
  // While the first send still holds it, nothing else may touch it.
  assert.equal((await sendOrderToRelay(lostReply.id, "test")).ok, false);
  assert.equal((await state(lostReply.id)).status, "PAID");
  // Its claim runs out. The next send finds the copy instead of making another.
  await expireClaim(lostReply.id);
  const resumed = await sendOrderToRelay(lostReply.id, "test");
  assert.deepEqual(resumed, { ok: true, relayOrderId: String(stray.id) });
  const adopted = (await shop("GET", `/orders/${stray.id}`)) as ShopOrder;
  assert.equal(adopted.status, "processing");
  // It goes to the printer with the order's address as it is now, not as the copy had it.
  assert.equal(`${adopted.shipping.first_name} ${adopted.shipping.last_name}, ${adopted.shipping.address_1}, ${adopted.shipping.city}`, "Sam Q Buyer, 1 Test St, Orlando");
  assert.equal(adopted.billing.email, "support@voidszn.com");
  assert.equal((await getOrder(String(strayTwo.id)))?.status, "trash");
  assert.equal((await copiesOf(lostReply.orderNumber)).length, 1);
  ok("a copy left by a cut-off send is found and released with today's address, and a stray second copy is binned");

  // A copy left behind that doesn't hold what was ordered is not released. A right one is made.
  const wrongCopy = await makeOrder([line("Black", "L", 2)]);
  assert.ok(await claimForRelay(db, wrongCopy.id));
  const short = (await shop("POST", "/orders", {
    status: "pending",
    line_items: [{ sku: sku("Black", "L"), quantity: 1 }],
    meta_data: [{ key: ORDER_META, value: wrongCopy.orderNumber }],
  })) as { id: number };
  await expireClaim(wrongCopy.id);
  const remade = await sendOrderToRelay(wrongCopy.id, "test");
  assert.equal(remade.ok, true);
  assert.notEqual(remade.ok ? remade.relayOrderId : "", String(short.id));
  assert.equal((await getOrder(String(short.id)))?.status, "trash");
  const right = (await shop("GET", `/orders/${remade.ok ? remade.relayOrderId : 0}`)) as ShopOrder;
  assert.deepEqual(right.line_items.map((item) => `${item.sku}x${item.quantity}`), [`${sku("Black", "L")}x2`]);
  ok("a left-behind copy with the wrong items is binned, not released");

  // The copy was written down but never released.
  const halfDone = await makeOrder([line("Black", "M", 1)]);
  const halfHeld = await claimForRelay(db, halfDone.id);
  assert.ok(halfHeld);
  const unreleased = (await shop("POST", "/orders", {
    status: "pending",
    line_items: [{ sku: sku("Black", "M"), quantity: 1 }],
    meta_data: [{ key: ORDER_META, value: halfDone.orderNumber }],
  })) as { id: number };
  await noteRelay(db, halfHeld, { externalOrderId: String(unreleased.id) }, { release: false });
  await expireClaim(halfDone.id);
  // The timed job finishes it even though sending by itself is switched off.
  await autoSince(null);
  const untouched = await makeOrder([line("Black", "M", 1)], { paidAt: ago(90) });
  const swept = await sendWaitingOrders(BUDGET);
  assert.equal(swept.sent, 1);
  assert.equal((await state(halfDone.id)).externalOrderId, String(unreleased.id));
  assert.equal((await getOrder(String(unreleased.id)))?.status, "processing");
  assert.equal((await state(untouched.id)).status, "PAID");
  assert.equal((await copiesOf(untouched.orderNumber)).length, 0);
  ok("with automatic sending off, the timed job only finishes what was cut off");

  /* ---- Sending by itself ---- */
  // Switched on just now: an order paid before that is backlog, and one paid a minute ago is still in its cancel window.
  await setAutoSend(db, true);
  const tooNew = await makeOrder([line("Black", "M", 1)], { paidAt: ago(1) });
  assert.deepEqual(await sendWaitingOrders(BUDGET), { sent: 0, failed: 0 });
  // On for two hours: the order paid 90 minutes ago goes, the one paid a minute ago waits, the one from before stays.
  await autoSince(ago(120));
  const backlog = await makeOrder([line("Black", "M", 1)], { paidAt: ago(300) });
  const partRefunded = await makeOrder([line("Black", "M", 1)], { paidAt: ago(90), paymentStatus: "PARTIALLY_REFUNDED" });
  assert.deepEqual(await sendWaitingOrders(BUDGET), { sent: 1, failed: 0 });
  assert.equal((await state(untouched.id)).status, "IN_PRODUCTION");
  for (const waitingOrder of [tooNew, backlog, partRefunded]) {
    assert.equal((await state(waitingOrder.id)).status, "PAID");
    assert.equal((await copiesOf(waitingOrder.orderNumber)).length, 0);
  }
  // A person can still send any of them.
  const everything = await ordersToRelay(db, 100, { kind: "everything" });
  assert.ok([tooNew, backlog, partRefunded].every((order) => everything.includes(order.id)));
  await autoSince(null);
  ok("sending by itself takes only orders paid since it was switched on, after the cancel window, and never a part-refunded one");

  /* ---- Orders that can't go ---- */
  const unknown = await makeOrder([{ sku: `RELAYTEST-${run}-GONE`, color: "Bone", size: "S", quantity: 1, productId }]);
  const missing = await sendOrderToRelay(unknown.id, "test");
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.error, /doesn't have Relay Test Tee .* \(Bone, S\)/);
  row = await state(unknown.id);
  assert.equal(`${row.status}/${row.fulfillmentStatus}/${row.externalOrderId}/${row.relayClaimedAt}`, "PAID/UNSUBMITTED/null/null");
  assert.equal((await copiesOf(unknown.orderNumber)).length, 0);
  assert.equal((await flagsOn(unknown.id)).length, 1);
  await sendOrderToRelay(unknown.id, "test");
  assert.equal((await flagsOn(unknown.id)).length, 1);
  // One the shop keeps refusing is not tried by itself for ever, but a person still can.
  await db.update(orders).set({ relayAttempts: 6, paidAt: ago(90) }).where(eq(orders.id, unknown.id));
  assert.ok(!(await ordersToRelay(db, 100, { kind: "automatic", since: ago(120), holdMinutes: 60 })).includes(unknown.id));
  assert.ok((await ordersToRelay(db, 100, { kind: "everything" })).includes(unknown.id));
  const noAddress = await makeOrder([line("Black", "M", 1)], { shippingAddress: { line1: "", city: "", state: "", postalCode: "", country: "" } });
  const stuck = await sendOrderToRelay(noAddress.id, "test");
  assert.match(stuck.ok ? "" : stuck.error, /no full shipping address/);
  const unpaid = await makeOrder([line("Black", "M", 1)], { status: "PENDING", paymentStatus: "UNPAID", paidAt: null });
  const early = await sendOrderToRelay(unpaid.id, "test");
  assert.match(early.ok ? "" : early.error, /hasn't been paid/);
  assert.equal((await copiesOf(noAddress.orderNumber)).length + (await copiesOf(unpaid.orderNumber)).length, 0);
  ok("an order with an item the shop lacks, no address or no payment is not sent, says why, and is flagged once");

  // A product the shop doesn't have yet is copied on the way.
  const fresh = `RELAYTEST-${run}-BONE-S`;
  const [bone] = await db.insert(productColors).values({ productId, name: "Bone", hex: "#EDEAE3", sortOrder: 2 }).returning({ id: productColors.id });
  await db.insert(productVariants).values({ productId, colorId: bone.id, size: "S", sku: fresh, priceCents: 3400 });
  const late = await makeOrder([{ sku: fresh, color: "Bone", size: "S", quantity: 1, productId }]);
  assert.equal((await sendOrderToRelay(late.id, "test")).ok, true);
  ok("an item added since the last copy is copied over on the way");

  // A SKU that points at another product's item in the shop is not good enough.
  // (A product renamed after it was copied leaves its old SKUs behind there.)
  const [impostor] = await db
    .insert(products)
    .values({ name: `Relay Other Tee ${run}`, slug: `${slug}-other`, priceCents: 3400, isActive: true })
    .returning({ id: products.id });
  const [otherColor] = await db.insert(productColors).values({ productId: impostor.id, name: "Black", hex: "#000000" }).returning({ id: productColors.id });
  await db.update(productVariants).set({ sku: `${sku("Olive", "M")}-RENAMED`, updatedAt: sql`${productVariants.updatedAt}` }).where(eq(productVariants.sku, sku("Olive", "M")));
  await db.insert(productVariants).values({ productId: impostor.id, colorId: otherColor.id, size: "M", sku: sku("Olive", "M"), priceCents: 3400 });
  const confused = await makeOrder([{ sku: sku("Olive", "M"), color: "Black", size: "M", quantity: 1, productId: impostor.id }]);
  const refusedMix = await sendOrderToRelay(confused.id, "test");
  assert.equal(refusedMix.ok, false);
  assert.match(refusedMix.ok ? "" : refusedMix.error, /doesn't have Relay Test Tee/);
  assert.equal((await copiesOf(confused.orderNumber)).length, 0);
  await db.delete(products).where(eq(products.id, impostor.id));
  // Once the renamed size is copied again, it is the same item in the shop under its new SKU, not a second one.
  const before = (await listVariations(parent.id)).length;
  assert.deepEqual(await syncProductToRelay(productId), { ok: true });
  const after = await listVariations(parent.id);
  assert.equal(after.length, before);
  assert.ok(after.some((variation) => variation.sku === `${sku("Olive", "M")}-RENAMED`));
  await db.update(productVariants).set({ sku: sku("Olive", "M") }).where(eq(productVariants.sku, `${sku("Olive", "M")}-RENAMED`));
  assert.deepEqual(await syncProductToRelay(productId), { ok: true });
  ok("an item is only matched under its own product, and a renamed size keeps its place in the shop");

  /* ---- The printer ships it ---- */
  row = await state(first.id);
  assert.deepEqual(await followRelayedOrders(BUDGET), { shipped: 0, problems: 0 });
  await shop("PUT", `/orders/${row.externalOrderId}`, { status: "completed" });
  let follow = await followRelayedOrders(BUDGET);
  assert.equal(follow.problems, 1);
  row = await state(first.id);
  assert.equal(row.status, "IN_PRODUCTION");
  assert.match(row.fulfillmentError ?? "", /no tracking number/);
  // Said once, not on every run.
  assert.equal((await followRelayedOrders(BUDGET)).problems, 0);
  await shop("PUT", `/orders/${row.externalOrderId}`, {
    meta_data: [{ key: "_wc_shipment_tracking_items", value: [{ tracking_provider: "USPS", tracking_number: "9400111899223100001234", date_shipped: "1760000000" }] }],
  });
  follow = await followRelayedOrders(BUDGET);
  assert.equal(follow.shipped, 1);
  row = await state(first.id);
  assert.equal(`${row.status}/${row.fulfillmentStatus}/${row.shippingCarrier}/${row.trackingNumber}`, "SHIPPED/SHIPPED/USPS/9400111899223100001234");
  assert.match(row.trackingUrl ?? "", /^https:\/\/tools\.usps\.com\//);
  assert.equal(row.fulfillmentError, null);
  assert.equal((await followRelayedOrders(BUDGET)).shipped, 0);
  ok("when the printer ships, the order is marked shipped with its tracking, once; no tracking is flagged, once");

  // Tracking that only arrives as a note.
  row = await state(race.id);
  await shop("PUT", `/orders/${row.externalOrderId}`, { status: "completed" });
  await shop("POST", `/orders/${row.externalOrderId}/notes`, { note: "Your order shipped with UPS. Tracking number: 1Z999AA10123456784" });
  assert.equal((await followRelayedOrders(BUDGET)).shipped, 1);
  assert.equal((await state(race.id)).trackingNumber, "1Z999AA10123456784");
  ok("tracking left as a note on the order is picked up too");

  // Marked as shipped, then cut off before the email: the next run sends it.
  const mailsTo = async (email: string) =>
    ((await (await fetch(`${process.env.RESEND_API_URL}/_sent`)).json()) as { to: string[]; subject: string }[]).filter((sent) => sent.to[0] === email);
  if (process.env.RESEND_API_URL) {
    row = await state(untouched.id);
    assert.equal(await shipFromRelay(db, untouched.id, { carrier: "USPS", number: "9400111899223100005678", url: "" }), true);
    assert.equal((await mailsTo(row.email)).length, 0);
    await followRelayedOrders(BUDGET);
    assert.equal((await mailsTo(row.email)).length, 1);
    await followRelayedOrders(BUDGET);
    assert.equal((await mailsTo(row.email)).length, 1);
    ok("a customer whose shipping email was missed is emailed on the next run, once");
  }

  // The id on our order must be our order over there. If the shop was swapped for another, nothing is acted on.
  row = await state(late.id);
  const lateCopy = row.externalOrderId as string;
  const foreign = (await shop("POST", "/orders", {
    status: "completed",
    line_items: [{ sku: sku("Black", "M"), quantity: 1 }],
    meta_data: [
      { key: ORDER_META, value: "VS-SOMEONEELSE" },
      { key: "_tracking_number", value: "9400111899223100004321" },
    ],
  })) as { id: number };
  await db.update(orders).set({ externalOrderId: String(foreign.id) }).where(eq(orders.id, late.id));
  follow = await followRelayedOrders(BUDGET);
  row = await state(late.id);
  assert.equal(row.status, "IN_PRODUCTION");
  assert.match(row.fulfillmentError ?? "", /is not this order/);
  assert.match(await withdrawFromRelay(late.orderNumber, "cancelled"), new RegExp(`cancelled in the relay store, but the printer keeps orders it has already taken\\. Open the printer's dashboard, find order ${lateCopy} and cancel it there`));
  assert.equal((await getOrder(String(foreign.id)))?.status, "completed"); // someone else's order is left alone
  assert.equal((await getOrder(lateCopy))?.status, "cancelled"); // ours was still found, by its order number
  await db.update(orders).set({ externalOrderId: lateCopy, fulfillmentError: null }).where(eq(orders.id, late.id));
  ok("an order in the shop that doesn't say it is ours is never shipped from, changed or cancelled");

  // With the printer for too long.
  row = await state(wrongCopy.id);
  await db.update(orders).set({ fulfillmentSubmittedAt: ago(11 * 24 * 60) }).where(eq(orders.id, wrongCopy.id));
  await followRelayedOrders(BUDGET);
  assert.match((await state(wrongCopy.id)).fulfillmentError ?? "", /more than 10 days/);
  assert.equal((await flagsOn(wrongCopy.id)).filter((flag) => flag.includes("more than 10 days")).length, 1);
  await followRelayedOrders(BUDGET);
  assert.equal((await flagsOn(wrongCopy.id)).filter((flag) => flag.includes("more than 10 days")).length, 1);
  ok("an order that sits with the printer for more than 10 days is flagged, once");

  /* ---- Cancelled on the printer's side ---- */
  row = await state(lostReply.id);
  const cancelledCopy = row.externalOrderId as string;
  await shop("PUT", `/orders/${cancelledCopy}`, { status: "cancelled" });
  row = await state(halfDone.id);
  await shop("DELETE", `/orders/${row.externalOrderId}`);
  follow = await followRelayedOrders(BUDGET);
  assert.equal(follow.problems, 2);
  row = await state(lostReply.id);
  assert.equal(`${row.status}/${row.fulfillmentStatus}`, "PAID/FAILED");
  assert.match(row.fulfillmentError ?? "", /was marked cancelled in the relay store/);
  assert.match((await state(halfDone.id)).fulfillmentError ?? "", /was deleted in the relay store/);
  // A failed order is never sent again by itself.
  await db.update(orders).set({ paidAt: ago(90) }).where(inArray(orders.id, [lostReply.id, halfDone.id]));
  await autoSince(ago(120));
  await sendWaitingOrders(BUDGET);
  await autoSince(null);
  assert.equal((await state(lostReply.id)).status, "PAID");
  assert.equal((await sendOrderToRelay(lostReply.id, "test")).ok, false);
  // A person sends it again: a new copy, not the cancelled one.
  assert.equal(await resetRelay(db, lostReply.orderNumber, "test"), lostReply.id);
  assert.equal(await resetRelay(db, lostReply.orderNumber, "test"), null); // only a failed order can be reset
  const resent = await sendOrderToRelay(lostReply.id, "test");
  assert.equal(resent.ok, true);
  assert.notEqual(resent.ok ? resent.relayOrderId : "", cancelledCopy);
  assert.equal((await copiesOf(lostReply.orderNumber)).length, 1);
  // The other one: someone brings its copy back in the shop before it is sent again. That copy is taken up, not doubled.
  row = await state(halfDone.id);
  const revived = row.externalOrderId as string;
  await shop("PUT", `/orders/${revived}`, { status: "processing" });
  assert.equal(await resetRelay(db, halfDone.orderNumber, "test"), halfDone.id);
  assert.deepEqual(await sendOrderToRelay(halfDone.id, "test"), { ok: true, relayOrderId: revived });
  assert.equal((await copiesOf(halfDone.orderNumber)).length, 1);
  ok("an order cancelled or deleted in the shop is flagged, never re-sent by itself, and sending it again never doubles it");

  /* ---- Changes made here reach the shop ---- */
  await db.update(orders).set({ shippingName: "Alex Mover", shippingAddress: { line1: "9 New Rd", city: "Miami", state: "FL", postalCode: "33101", country: "US" } }).where(eq(orders.id, lostReply.id));
  assert.match(await pushAddressToRelay(lostReply.orderNumber), /has the new address too/);
  row = await state(lostReply.id);
  const moved = (await shop("GET", `/orders/${row.externalOrderId}`)) as ShopOrder;
  assert.equal(`${moved.shipping.first_name} ${moved.shipping.last_name}, ${moved.shipping.address_1}, ${moved.shipping.city}`, "Alex Mover, 9 New Rd, Miami");
  assert.equal(`${moved.billing.first_name}, ${moved.billing.address_1}, ${moved.billing.email}`, "Alex, 9 New Rd, support@voidszn.com");
  await cancelOrder(db, lostReply.orderNumber, "test", "changed their mind");
  assert.match(await withdrawFromRelay(lostReply.orderNumber, "cancelled"), /cancelled in the relay store, but the printer keeps/);
  assert.equal((await copiesOf(lostReply.orderNumber)).length, 0);
  assert.match(await withdrawFromRelay(first.orderNumber, "refunded"), /already finished this order when it was refunded/);
  assert.equal(await withdrawFromRelay(unknown.orderNumber, "cancelled"), "");
  ok("a corrected address and a cancellation are passed on, and a shipped order is not cancelled");

  /* ---- An order changed while its send was half-done ---- */
  // Cancelled while its copy sat unreleased and unrecorded: the copy is found and binned.
  const midCancel = await makeOrder([line("Black", "M", 1)]);
  assert.ok(await claimForRelay(db, midCancel.id));
  await shop("POST", "/orders", { status: "pending", line_items: [{ sku: sku("Black", "M"), quantity: 1 }], meta_data: [{ key: ORDER_META, value: midCancel.orderNumber }] });
  await cancelOrder(db, midCancel.orderNumber, "test", "");
  assert.equal(await withdrawFromRelay(midCancel.orderNumber, "cancelled"), "");
  assert.equal((await copiesOf(midCancel.orderNumber)).length, 0);
  // Refunded after the release went through but before this site heard: the copy is cancelled and flagged.
  const midRefund = await makeOrder([line("Black", "M", 1)]);
  assert.ok(await claimForRelay(db, midRefund.id));
  await shop("POST", "/orders", { status: "processing", line_items: [{ sku: sku("Black", "M"), quantity: 1 }], meta_data: [{ key: ORDER_META, value: midRefund.orderNumber }] });
  await db.update(orders).set({ status: "REFUNDED", paymentStatus: "REFUNDED", fulfillmentStatus: "CANCELLED" }).where(eq(orders.id, midRefund.id));
  assert.match(await withdrawFromRelay(midRefund.orderNumber, "refunded"), /cancelled in the relay store, but the printer keeps/);
  assert.equal((await copiesOf(midRefund.orderNumber)).length, 0);
  assert.equal((await flagsOn(midRefund.id)).length, 1);
  // And a send that wakes up to find its order cancelled does not release anything.
  await expireClaim(midCancel.id);
  assert.equal((await sendOrderToRelay(midCancel.id, "test")).ok, false);
  assert.equal((await copiesOf(midCancel.orderNumber)).length, 0);
  ok("an order cancelled or refunded while half-sent has every copy taken back, recorded or not");

  // Cancelling at any moment during a real send never leaves a copy for the printer.
  for (const delay of [0, 60, 200, 450, 800, 1300]) {
    const racing = await makeOrder([line("Black", "L", 1)]);
    await Promise.all([
      sendOrderToRelay(racing.id, "test").catch(() => undefined),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await cancelOrder(db, racing.orderNumber, "test", "");
        await withdrawFromRelay(racing.orderNumber, "cancelled");
      })(),
    ]);
    assert.equal((await state(racing.id)).status, "CANCELLED");
    assert.equal((await copiesOf(racing.orderNumber)).length, 0, `a copy was left after cancelling ${delay} ms into a send`);
  }
  ok("cancelling at any moment during a send leaves nothing with the printer");

  // Placed by hand instead: the relay lets go of it for good.
  const byHand = await makeOrder([line("Black", "M", 1)]);
  assert.equal((await sendOrderToRelay(byHand.id, "test")).ok, true);
  row = await state(byHand.id);
  const handCopy = row.externalOrderId as string;
  await failFromRelay(db, byHand.id, "test failure");
  await markInProduction(db, byHand.orderNumber, "test");
  assert.match(await withdrawFromRelay(byHand.orderNumber, "placed by hand"), /cancelled in the relay store, but the printer keeps/);
  row = await state(byHand.id);
  assert.equal(`${row.status}/${row.fulfillmentProvider}/${row.externalOrderId}/${row.fulfillmentError}`, "IN_PRODUCTION/MANUAL/null/null");
  assert.equal((await getOrder(handCopy))?.status, "cancelled");
  follow = await followRelayedOrders(BUDGET);
  assert.equal((await state(byHand.id)).status, "IN_PRODUCTION");
  ok("an order placed with the printer by hand has its relay copy cancelled and is left alone after that");

  assert.equal(await claimRelayRun(db, 4), true);
  assert.equal(await claimRelayRun(db, 4), false);
  ok("the timed job can't be run over and over");

  const overview = await relayOverview(db);
  assert.ok(overview.orders.withPrinter >= 1 && overview.orders.shipped >= 2 && overview.products.copied >= 1);
  assert.ok(overview.problems.some((problem) => problem.orderNumber === unknown.orderNumber));
  ok("the overview counts what is waiting, with the printer, shipped and stuck");

  /* ---- Tidy up ---- */
  const mine = await db.select({ id: orders.id, externalOrderId: orders.externalOrderId, customerId: orders.customerId }).from(orders).where(like(orders.orderNumber, `VS-RT${run}%`));
  for (const order of mine) {
    if (order.externalOrderId) await binOrder(Number(order.externalOrderId)).catch(() => undefined);
  }
  await db.delete(orders).where(inArray(orders.id, mine.map((order) => order.id)));
  await db.delete(customers).where(inArray(customers.id, mine.map((order) => order.customerId)));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(storeSettings).where(inArray(storeSettings.key, ["relay.settings", "relay.lastRun"]));

  console.log(`\n${passed} checks passed`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
