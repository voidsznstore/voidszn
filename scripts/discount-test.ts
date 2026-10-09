/**
 * Checks for discount codes, saved carts and the dates typed into the admin.
 *
 *   npm run test:discounts
 *
 * The sums need nothing. The rest runs only when DATABASE_URL points at a scratch
 * database (never production) and deletes what it writes.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../src/db";
import { emailForToken } from "../src/db/queries/admin-campaigns";
import { createDiscount, discountState, listDiscounts, updateDiscount } from "../src/db/queries/admin-discounts";
import { FormError } from "../src/db/queries/admin-catalog";
import { claimDueCarts, closeFinishedCarts, findCartByToken, markCartsRecovered, saveCart } from "../src/db/queries/carts";
import { type DiscountCode, findDiscountByCode } from "../src/db/queries/discounts";
import { type PaidOrderInput, recordPaidOrder } from "../src/db/queries/orders";
import {
  abandonedCarts,
  customers,
  discountCodes,
  discountRedemptions,
  emailOptouts,
  orderEvents,
  orders,
  subscribers,
  webhookEvents,
} from "../src/db/schema";
import { fromLocalInput, toLocalInput } from "../src/lib/admin/format";
import { applyCode, codeProblem, resolveDiscount, totalsFor } from "../src/lib/checkout/discounts";
import type { PricedCart } from "../src/lib/checkout/pricing";
import { discountLabel, discountSummary, linkWithCode, normalizeCode } from "../src/lib/discounts/describe";
import { hasPlaceholder } from "../src/lib/email/presets";
import { subscribe } from "../src/db/queries/subscribers";
import { usableEmailDiscount } from "../src/lib/email/automation";
import { campaignEmail, cartReminderEmail, couponTerms, orderDeliveredEmail } from "../src/lib/email/templates";

let passed = 0;
function ok(label: string) {
  passed += 1;
  console.log(`  ok  ${label}`);
}

const cart = (subtotalCents: number, shippingCents = 524): PricedCart => ({
  lines: [],
  subtotalCents,
  shippingCents,
});
const code = (overrides: Partial<DiscountCode>): DiscountCode => ({
  id: randomUUID(),
  code: "TEST",
  type: "PERCENTAGE",
  value: 20,
  note: null,
  minOrderCents: 0,
  maxUses: null,
  usedCount: 0,
  perCustomerLimit: null,
  isActive: true,
  startsAt: null,
  expiresAt: null,
  affiliateId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function sums() {
  console.log("What a code takes off");

  let result = applyCode(code({ type: "PERCENTAGE", value: 20 }), cart(6400));
  assert.ok(result.ok);
  assert.equal(result.discount.discountCents, 1280);
  assert.deepEqual(totalsFor(cart(6400), result.discount), {
    subtotalCents: 6400,
    discountCents: 1280,
    shippingCents: 524,
    shippingBeforeCents: 524,
    totalCents: 6400 - 1280 + 524,
  });
  ok("a percentage comes off the items, not the shipping");

  result = applyCode(code({ type: "PERCENTAGE", value: 15 }), cart(3333));
  assert.ok(result.ok);
  assert.equal(result.discount.discountCents, 500);
  ok("a percentage rounds to the nearest cent");

  result = applyCode(code({ type: "FIXED", value: 500 }), cart(3200));
  assert.ok(result.ok);
  assert.equal(result.discount.discountCents, 500);
  result = applyCode(code({ type: "FIXED", value: 5000 }), cart(3200));
  assert.ok(result.ok);
  assert.equal(result.discount.discountCents, 3200);
  assert.equal(totalsFor(cart(3200), result.discount).totalCents, 524);
  ok("an amount off never takes more than the items cost");

  result = applyCode(code({ type: "FREE_SHIPPING", value: 0 }), cart(3200));
  assert.ok(result.ok);
  assert.equal(result.discount.discountCents, 0);
  assert.equal(result.discount.freeShipping, true);
  assert.equal(totalsFor(cart(3200), result.discount).totalCents, 3200);
  assert.equal(totalsFor(cart(3200), result.discount).shippingCents, 0);
  ok("free shipping takes off the shipping and nothing else");

  result = applyCode(code({ minOrderCents: 4000 }), cart(3999));
  assert.equal(result.ok, false);
  assert.ok(applyCode(code({ minOrderCents: 4000 }), cart(4000)).ok);
  ok("a minimum order is enforced on the items, to the cent");

  assert.equal(totalsFor(cart(3200), null).totalCents, 3724);
  ok("no code changes nothing");

  console.log("When a code works");
  const now = new Date("2026-10-09T12:00:00Z");
  assert.equal(codeProblem(code({}), now), null);
  assert.ok(codeProblem(code({ isActive: false }), now));
  assert.ok(codeProblem(code({ startsAt: new Date("2026-10-10T00:00:00Z") }), now));
  assert.equal(codeProblem(code({ startsAt: new Date("2026-10-09T12:00:00Z") }), now), null);
  assert.ok(codeProblem(code({ expiresAt: new Date("2026-10-09T12:00:00Z") }), now));
  assert.equal(codeProblem(code({ expiresAt: new Date("2026-10-09T12:00:01Z") }), now), null);
  assert.ok(codeProblem(code({ maxUses: 5, usedCount: 5 }), now));
  assert.equal(codeProblem(code({ maxUses: 5, usedCount: 4 }), now), null);
  ok("off, not started, expired and used-up codes are refused");

  assert.equal(discountState(code({}), now), "active");
  assert.equal(discountState(code({ isActive: false }), now), "off");
  assert.equal(discountState(code({ startsAt: new Date("2027-01-01T00:00:00Z") }), now), "scheduled");
  assert.equal(discountState(code({ expiresAt: new Date("2026-01-01T00:00:00Z") }), now), "expired");
  assert.equal(discountState(code({ maxUses: 1, usedCount: 1 }), now), "used_up");
  ok("the admin's status matches");

  console.log("Words and links");
  assert.equal(discountLabel({ type: "PERCENTAGE", value: 20 }), "20% off");
  assert.equal(discountLabel({ type: "FIXED", value: 500 }), "$5 off");
  assert.equal(discountLabel({ type: "FIXED", value: 750 }), "$7.50 off");
  assert.equal(discountLabel({ type: "FREE_SHIPPING", value: 0 }), "Free shipping");
  assert.equal(discountSummary({ type: "PERCENTAGE", value: 20, minOrderCents: 4000 }), "20% off orders over $40");
  assert.equal(discountSummary({ type: "FREE_SHIPPING", value: 0, minOrderCents: 5000 }), "Free shipping on orders over $50");
  assert.equal(normalizeCode("  spooky 20 "), "SPOOKY20");
  ok("codes read the same everywhere");

  const site = "https://www.voidszn.com";
  assert.equal(linkWithCode(`${site}/collections/all`, "SAVE20", site), `${site}/collections/all?code=SAVE20`);
  assert.equal(linkWithCode("https://voidszn.com/x?a=1", "SAVE20", site), "https://voidszn.com/x?a=1&code=SAVE20");
  assert.equal(linkWithCode("https://example.com/x", "SAVE20", site), "https://example.com/x");
  assert.equal(linkWithCode(`${site}/x`, null, site), `${site}/x`);
  assert.equal(linkWithCode("not a link", "SAVE20", site), "not a link");
  ok("a code is only ever added to the store's own links");

  assert.equal(hasPlaceholder("The [OCCASION] designs"), true);
  assert.equal(hasPlaceholder("Order by [DATE] to"), true);
  assert.equal(hasPlaceholder("Sizes [S to 2XL] in stock"), false);
  assert.equal(hasPlaceholder("Nothing here"), false);
  ok("unfilled template blanks are spotted");

  console.log("Emails");
  const discount = { code: "SAVE20", type: "PERCENTAGE" as const, value: 20, minOrderCents: 0, expiresAt: null, oncePerCustomer: false };
  const campaign = campaignEmail(
    { subject: "Sale <now>", preheader: "", heading: "", body: "Hello & welcome", imageUrl: null, buttonLabel: "Shop", buttonUrl: "https://www.voidszn.com/collections/all", discount },
    "https://www.voidszn.com/unsubscribe/abc",
  );
  assert.ok(campaign.html.includes("collections/all?code=SAVE20"));
  assert.ok(campaign.html.includes("Sale &lt;now&gt;"));
  assert.ok(campaign.html.includes("Hello &amp; welcome"));
  assert.ok(campaign.html.includes("/unsubscribe/abc"));
  assert.ok(campaign.html.includes("14735 Gainsborough"));
  assert.ok(campaign.text.includes("SAVE20"));
  assert.ok(campaign.text.includes("14735 Gainsborough"));
  ok("a campaign carries its code, an unsubscribe link and the mailing address");

  const reminder = cartReminderEmail({
    step: 3,
    items: [{ name: "Tee", color: "Black", size: "M", quantity: 2, unitPriceCents: 3200, imageUrl: null }],
    restoreUrl: "https://www.voidszn.com/cart/tokentokentokentokentoken",
    discount,
    unsubscribeUrl: "https://www.voidszn.com/unsubscribe/tokentokentokentokentoken",
  });
  assert.ok(reminder.html.includes("/cart/tokentokentokentokentoken?code=SAVE20"));
  assert.ok(reminder.html.includes("$64.00"));
  assert.ok(reminder.html.includes("Unsubscribe"));
  assert.ok(reminder.html.includes("14735 Gainsborough"));
  ok("a cart reminder links back to the cart with its code, and can be stopped");

  const delivered = orderDeliveredEmail({ orderNumber: "VS-TEST1234", customerName: "Sam", discount: null });
  assert.equal(delivered.html.includes("code="), false);
  assert.equal(delivered.html.includes("Unsubscribe"), false);
  ok("the delivered email has no offer unless a code is set");

  const thanks = orderDeliveredEmail({
    orderNumber: "VS-TEST1234",
    customerName: "Sam",
    discount: { ...discount, type: "FREE_SHIPPING", value: 0 },
    unsubscribeUrl: "https://www.voidszn.com/unsubscribe/abc",
  });
  assert.equal(thanks.subject, "Delivered. Here's free shipping on your next order");
  assert.ok(thanks.html.includes("/unsubscribe/abc"));
  assert.equal(
    orderDeliveredEmail({ orderNumber: "VS-TEST1234", customerName: "Sam", discount }).subject,
    "Delivered. Here's 20% off your next order",
  );
  ok("with a code it reads right for every kind of code, and can be unsubscribed from");

  const terms = (expiresAt: string) => couponTerms({ ...discount, expiresAt: new Date(expiresAt) });
  assert.equal(terms("2026-11-01T04:00:00Z"), "Ends October 31."); // midnight Eastern on Nov 1
  assert.equal(terms("2026-11-01T03:59:00Z"), "Ends October 31."); // 11:59 PM on Oct 31
  assert.equal(terms("2026-11-01T16:00:00Z"), "Ends November 1."); // noon on Nov 1
  assert.equal(couponTerms({ ...discount, limited: true, oncePerCustomer: true }), "One use per customer. Limited number of uses.");
  ok("a code that ends at midnight is said to end the day before");

  const offsite = campaignEmail(
    { subject: "Hi", preheader: "", body: "Hello", imageUrl: null, buttonLabel: "Go", buttonUrl: "https://example.com/x", discount },
    "https://www.voidszn.com/unsubscribe/abc",
  );
  assert.equal(offsite.html.includes("adds the code for you"), false);
  ok("a button that leaves the store doesn't claim to add the code");

  console.log("Dates typed in the admin (Eastern Time)");
  assert.equal(fromLocalInput("2026-10-31T23:59")?.toISOString(), "2026-11-01T03:59:00.000Z");
  assert.equal(fromLocalInput("2026-12-01T00:00")?.toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal(fromLocalInput("2026-07-04T09:30")?.toISOString(), "2026-07-04T13:30:00.000Z");
  assert.equal(fromLocalInput("nonsense"), null);
  assert.equal(toLocalInput(new Date("2026-11-01T03:59:00.000Z")), "2026-10-31T23:59");
  assert.equal(toLocalInput(fromLocalInput("2026-03-08T12:00")), "2026-03-08T12:00");
  ok("a date goes in and comes back the same, either side of a clock change");
}

async function database() {
  if (!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)) {
    console.log("Saved codes and carts: skipped (no DATABASE_URL)");
    return;
  }
  console.log("Saved codes and carts");
  const db = getDb();
  const run = randomUUID().slice(0, 8).toUpperCase();
  const CODE = `T${run}`;
  const email = `discount-${run.toLowerCase()}@example.com`;
  const refs = [1, 2, 3].map((n) => `PAYdiscount${run}${n}`);

  const cleanup = async () => {
    await db.delete(orders).where(inArray(orders.paymentRef, refs));
    await db.delete(abandonedCarts).where(eq(abandonedCarts.email, email));
    await db.delete(customers).where(eq(customers.email, email));
    await db.delete(emailOptouts).where(eq(emailOptouts.email, email));
    await db.delete(subscribers).where(eq(subscribers.email, email));
    await db.delete(discountCodes).where(like(discountCodes.code, `T${run}%`));
    await db.delete(webhookEvents).where(eq(webhookEvents.provider, `discount-test-${run}`));
  };
  await cleanup();

  const base = {
    code: CODE,
    type: "PERCENTAGE" as const,
    value: 25,
    minOrderCents: 0,
    maxUses: 2,
    oncePerCustomer: true,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    note: "",
  };
  const order = (n: number, buyer = email): PaidOrderInput => ({
    event: { provider: `discount-test-${run}`, id: `evt_${n}`, type: "payment.updated" },
    paymentRef: refs[n - 1],
    paymentProvider: "square",
    email: buyer,
    customerName: "Test Buyer",
    phone: null,
    currency: "usd",
    subtotalCents: 6400,
    discountCents: 1600,
    shippingCents: 524,
    taxCents: 0,
    totalCents: 5324,
    shippingName: "Test Buyer",
    shippingAddress: { line1: "1 Test St", city: "Orlando", state: "FL", postalCode: "32801", country: "US" },
    shippingMethod: "Standard shipping",
    discountCode: CODE,
    items: [{ slug: "sample-tee-01", productName: "Sample Tee 01", colorName: "Black", size: "M", quantity: 2, unitPriceCents: 3200 }],
  });

  try {
    const id = await createDiscount(db, base);
    await assert.rejects(() => createDiscount(db, base), FormError);
    ok("two codes can't share a name");

    const found = await findDiscountByCode(db, CODE.toLowerCase());
    assert.equal(found?.id, id);
    assert.equal(found?.perCustomerLimit, 1);
    ok("a code is found however it is typed");

    let resolved = await resolveDiscount(` ${CODE.toLowerCase()} `, cart(6400), email);
    assert.ok(resolved.ok);
    assert.equal(resolved.discount.discountCents, 1600);
    assert.equal((await resolveDiscount("NOPE-NOT-A-CODE", cart(6400), email)).ok, false);
    assert.equal((await resolveDiscount("'; drop table orders; --", cart(6400), email)).ok, false);
    ok("a real code applies, a made-up one doesn't");

    const first = await recordPaidOrder(db, { ...order(1), discountCodeId: id });
    assert.equal(first.status, "created");
    let [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
    assert.equal(row.usedCount, 1);
    const redemptions = await db.select().from(discountRedemptions).where(eq(discountRedemptions.discountCodeId, id));
    assert.equal(redemptions.length, 1);
    assert.equal(redemptions[0].email, email);
    const [saved] = await db.select().from(orders).where(eq(orders.paymentRef, refs[0]));
    assert.equal(saved.discountCodeId, id);
    assert.equal(saved.discountCodeText, CODE);
    assert.equal(saved.discountCents, 1600);
    ok("a paid order counts the use and remembers the code");

    assert.deepEqual(await recordPaidOrder(db, { ...order(1), discountCodeId: id }), { status: "order_exists" });
    [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
    assert.equal(row.usedCount, 1);
    ok("the same payment arriving twice counts once");

    resolved = await resolveDiscount(CODE, cart(6400), email);
    assert.equal(resolved.ok, false);
    assert.ok((await resolveDiscount(CODE, cart(6400), `other-${email}`)).ok);
    ok("a once-per-customer code is refused the second time, for that customer only");

    // Someone gets past the check (a different email typed on the payment page).
    await recordPaidOrder(db, { ...order(2), discountCodeId: id });
    const [second] = await db.select().from(orders).where(eq(orders.paymentRef, refs[1]));
    const notes = await db.select().from(orderEvents).where(eq(orderEvents.orderId, second.id));
    assert.ok(notes.some((note) => note.type === "order.attention" && note.message?.includes("2 times")));
    ok("a second use by the same customer is noted on the order");

    [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
    assert.equal(row.usedCount, 2);
    assert.equal((await resolveDiscount(CODE, cart(6400), `third-${email}`)).ok, false);
    ok("a code stops working once its uses run out");

    // A third payment that started before the code ran out is still saved.
    const third = await recordPaidOrder(db, { ...order(3), discountCodeId: id });
    assert.equal(third.status, "created");
    [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
    assert.equal(row.usedCount, 2);
    ok("an order paid after the code ran out is saved, and the count never passes the limit");

    await assert.rejects(() => updateDiscount(db, id, { ...base, maxUses: 1 }), FormError);
    await updateDiscount(db, id, { ...base, maxUses: 10, type: "FREE_SHIPPING", value: 99 });
    [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
    assert.equal(row.type, "FREE_SHIPPING");
    assert.equal(row.value, 0);
    ok("the limit can't be set below what has been used, and free shipping saves cleanly");

    const listed = await listDiscounts(db, { view: "active", type: "FREE_SHIPPING", q: run.toLowerCase(), sort: "code" });
    assert.deepEqual(listed.map((item) => item.code), [CODE]);
    assert.equal((await listDiscounts(db, { view: "ended", type: "any", q: run, sort: "newest" })).length, 0);
    ok("the admin list filters by status, type and search");

    await db.delete(discountCodes).where(eq(discountCodes.id, id));
    const [kept] = await db.select().from(orders).where(eq(orders.paymentRef, refs[0]));
    assert.equal(kept.discountCodeId, null);
    assert.equal(kept.discountCodeText, CODE);
    ok("deleting a code leaves its orders with the code's name");

    // Carts
    await db.delete(orders).where(inArray(orders.paymentRef, refs));
    const items = [{ slug: "sample-tee-01", name: "Sample Tee 01", color: "Black", size: "M", quantity: 1, unitPriceCents: 3200, imageUrl: null }];
    await saveCart(db, { email: email.toUpperCase(), items, totalCents: 3724, paymentOrderRef: `ORDER${run}a` });
    await saveCart(db, { email, items: [...items, ...items], totalCents: 7000, paymentOrderRef: `ORDER${run}b` });
    let carts = await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email));
    assert.equal(carts.length, 1);
    assert.equal(carts[0].totalCents, 7000);
    assert.equal(carts[0].items.length, 2);
    ok("starting checkout twice keeps one cart, the newest");

    const token = carts[0].recoveryToken;
    assert.equal((await findCartByToken(db, token))?.email, email);
    assert.equal(await findCartByToken(db, "short"), null);
    assert.equal(await emailForToken(db, token), email);
    ok("a reminder's link finds its cart, and its unsubscribe link finds the address");

    assert.equal((await claimDueCarts(db, 0, 1)).filter((item) => item.email === email).length, 0);
    ok("a cart left a minute ago is not reminded");

    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    await db.update(abandonedCarts).set({ leftAt: hoursAgo(2) }).where(eq(abandonedCarts.email, email));
    const both = await Promise.all([claimDueCarts(db, 0, 1), claimDueCarts(db, 0, 1)]);
    assert.equal(both.flat().filter((item) => item.email === email).length, 1);
    ok("two runs at once send the first reminder once");

    await db.update(abandonedCarts).set({ leftAt: hoursAgo(30) }).where(eq(abandonedCarts.email, email));
    assert.equal((await claimDueCarts(db, 1, 24)).filter((item) => item.email === email).length, 0);
    await db.update(abandonedCarts).set({ lastEmailedAt: hoursAgo(13) }).where(eq(abandonedCarts.email, email));
    assert.equal((await claimDueCarts(db, 1, 24)).filter((item) => item.email === email).length, 1);
    ok("the second reminder waits its turn, and never follows the first too closely");

    await saveCart(db, { email, items, totalCents: 3724, paymentOrderRef: `ORDER${run}c` });
    [carts[0]] = await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email));
    assert.equal(carts[0].emailsSent, 2);
    assert.ok(Date.now() - carts[0].leftAt.getTime() < 5000);
    assert.equal((await claimDueCarts(db, 2, 72)).filter((item) => item.email === email).length, 0);
    ok("coming back to checkout moves the clock, and doesn't start the series again");

    const paid = await recordPaidOrder(db, order(1));
    assert.equal(paid.status, "created");
    await markCartsRecovered(db, { email, paymentOrderRef: `ORDER${run}c`, orderNumber: paid.status === "created" ? paid.orderNumber : "" });
    carts = await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email));
    assert.equal(carts[0].status, "RECOVERED");
    assert.ok(carts[0].recoveredOrderId);
    await db.update(abandonedCarts).set({ leftAt: hoursAgo(100) }).where(eq(abandonedCarts.email, email));
    assert.equal((await claimDueCarts(db, 0, 1)).filter((item) => item.email === email).length, 0);
    ok("paying closes the cart, and a closed cart is never reminded");

    // An order placed some other way (different payment page) still closes the cart.
    await db.delete(orders).where(inArray(orders.paymentRef, refs));
    await saveCart(db, { email, items, totalCents: 3724, paymentOrderRef: null });
    await db.update(abandonedCarts).set({ leftAt: hoursAgo(5) }).where(eq(abandonedCarts.email, email));
    await recordPaidOrder(db, order(2));
    await closeFinishedCarts(db);
    const open = await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email));
    assert.ok(open.every((item) => item.status === "RECOVERED"));
    ok("a cart whose owner has since ordered is closed before reminders go out");

    // A fresh cart for an address that has already had reminders carries on from there.
    await db.delete(orders).where(inArray(orders.paymentRef, refs));
    await db.delete(abandonedCarts).where(eq(abandonedCarts.email, email));
    await saveCart(db, { email, items, totalCents: 3724, paymentOrderRef: null });
    await db.update(abandonedCarts).set({ emailsSent: 2, status: "EXPIRED" }).where(eq(abandonedCarts.email, email));
    await saveCart(db, { email, items, totalCents: 3724, paymentOrderRef: null });
    const all = await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email));
    const fresh = all.find((item) => item.status === "OPEN");
    assert.equal(fresh?.emailsSent, 2);
    // It gets the third reminder and lapses. A cart after that gets none.
    await db.update(abandonedCarts).set({ emailsSent: 1, status: "EXPIRED" }).where(eq(abandonedCarts.id, fresh!.id));
    await saveCart(db, { email, items, totalCents: 3724, paymentOrderRef: null });
    const capped = (await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email))).find(
      (item) => item.status === "OPEN",
    );
    assert.equal(capped?.emailsSent, 3);
    await db.update(abandonedCarts).set({ leftAt: hoursAgo(100) }).where(eq(abandonedCarts.id, capped!.id));
    for (const step of [0, 1, 2]) {
      assert.equal((await claimDueCarts(db, step, 1)).filter((item) => item.email === email).length, 0);
    }
    ok("an address gets one series of reminders a month, however many carts are started with it");

    // Two checkouts started in the same instant leave one cart.
    await db.delete(abandonedCarts).where(eq(abandonedCarts.email, email));
    await Promise.all(
      [1, 2, 3, 4].map(() => saveCart(db, { email, items, totalCents: 3724, paymentOrderRef: null })),
    );
    assert.equal((await db.select().from(abandonedCarts).where(eq(abandonedCarts.email, email))).length, 1);
    ok("four checkouts at once for one address keep one cart");

    // Unsubscribing between the tidy-up and the send still stops the reminder.
    await db.update(abandonedCarts).set({ leftAt: hoursAgo(2) }).where(eq(abandonedCarts.email, email));
    await db.insert(emailOptouts).values({ email, source: "link" });
    assert.equal((await claimDueCarts(db, 0, 1)).filter((item) => item.email === email).length, 0);
    ok("someone who has unsubscribed is never taken for a reminder");

    // The marketing tick never undoes an unsubscribe.
    assert.equal(await subscribe(db, email, "checkout"), false);
    assert.equal((await db.select().from(emailOptouts).where(eq(emailOptouts.email, email))).length, 1);
    assert.equal((await db.select().from(subscribers).where(eq(subscribers.email, email))).length, 0);
    await db.delete(emailOptouts).where(eq(emailOptouts.email, email));
    assert.equal(await subscribe(db, email, "checkout"), true);
    assert.equal((await db.select().from(subscribers).where(eq(subscribers.email, email)))[0].isEmailSubscribed, true);
    ok("ticking the box at checkout joins the list, but never lifts an unsubscribe");

    // A code that vanished between checkout and payment doesn't stop the order being saved.
    const ghost = await recordPaidOrder(db, { ...order(3), discountCodeId: randomUUID() });
    assert.equal(ghost.status, "created");
    const [ghostOrder] = await db.select().from(orders).where(eq(orders.paymentRef, refs[2]));
    assert.equal(ghostOrder.discountCodeId, null);
    assert.equal(ghostOrder.discountCodeText, CODE);
    const ghostNotes = await db.select().from(orderEvents).where(eq(orderEvents.orderId, ghostOrder.id));
    assert.ok(ghostNotes.some((note) => note.type === "order.paid"));
    assert.ok(ghostNotes.some((note) => note.type === "order.attention" && note.message?.includes("could not be counted")));
    ok("an order whose code has been deleted is still saved, and flagged");

    // Emails only offer a code to someone who can use it.
    const offerId = await createDiscount(db, { ...base, code: `${CODE}X`, minOrderCents: 4000, maxUses: null, oncePerCustomer: true });
    assert.equal(await usableEmailDiscount(db, offerId, { email, subtotalCents: 3200 }), null);
    assert.equal((await usableEmailDiscount(db, offerId, { email, subtotalCents: 4000 }))?.code, `${CODE}X`);
    await db.insert(discountRedemptions).values({ discountCodeId: offerId, orderId: ghostOrder.id, email });
    assert.equal(await usableEmailDiscount(db, offerId, { email, subtotalCents: 9000 }), null);
    assert.equal((await usableEmailDiscount(db, offerId))?.code, `${CODE}X`);
    ok("a reminder leaves out a code the cart is too small for, or that the customer has already used");
  } finally {
    await cleanup();
  }
}

async function main() {
  sums();
  await database();
}

main()
  .then(() => {
    console.log(`\n${passed} checks passed`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
