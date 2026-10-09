/**
 * Checks for the books, the tax sums, partner payouts and team invitations.
 *
 *   npm run test:accounting
 *
 * The sums need nothing. The rest runs only when DATABASE_URL points at a scratch
 * database (never production) and deletes what it writes. The invitation checks
 * also need RESEND_API_URL pointing at a stand-in that lists what it was sent.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, isNull, like } from "drizzle-orm";
import { getDb } from "../src/db";
import { addExpense, addRecurring, endRecurring, loadFacts, setOrderCost } from "../src/db/queries/accounting";
import { recordPaidOrder } from "../src/db/queries/orders";
import {
  PayoutError,
  addAdjustment,
  cancelPayout,
  loadPayoutState,
  markPayoutSent,
  requestPayout,
  setShare,
} from "../src/db/queries/payouts";
import { listTeam, setAccess } from "../src/db/queries/team";
import {
  adminInvites,
  adminUsers,
  customers,
  expenses,
  orderEvents,
  orders,
  partnerPayouts,
  payoutAdjustments,
  profitShares,
  recurringCosts,
  webhookEvents,
} from "../src/db/schema";
import { addMonths, dayOf, isDay } from "../src/lib/accounting/days";
import {
  DEFAULT_ASSUMPTIONS,
  type Facts,
  type OrderFact,
  buildBooks,
  byMonth,
  occurrences,
  summarize,
} from "../src/lib/accounting/ledger";
import { earnedIn, shareOf, shareOn, statementFor } from "../src/lib/accounting/payouts";
import { FL_SURTAX_BPS, federalSetAside, floridaCounty, floridaSalesTax } from "../src/lib/accounting/tax";
import { parseDollars } from "../src/lib/money";

let passed = 0;
function ok(label: string) {
  passed += 1;
  console.log(`  ok  ${label}`);
}

const NOW = new Date("2026-10-09T15:00:00Z");
const order = (overrides: Partial<OrderFact>): OrderFact => ({
  orderNumber: "VS-TEST0001",
  paidAt: new Date("2026-10-05T16:00:00Z"),
  provider: "square",
  subtotalCents: 3200,
  discountCents: 0,
  shippingCents: 524,
  taxCents: 0,
  totalCents: 3724,
  state: "FL",
  postalCode: "32801",
  pickup: false,
  units: 1,
  holidayEligibleCents: 3200,
  itemsCostCents: 1100,
  linesWithoutCost: 0,
  costCents: null,
  processingFeeCents: null,
  neverMade: false,
  ...overrides,
});
const facts = (overrides: Partial<Facts>): Facts => ({
  orders: [],
  refunds: [],
  expenses: [],
  recurring: [],
  assumptions: DEFAULT_ASSUMPTIONS,
  ...overrides,
});
const tax = (overrides: Partial<Parameters<typeof floridaSalesTax>[0]>) =>
  floridaSalesTax({
    day: "2026-10-05",
    state: "FL",
    postalCode: "32801",
    pickup: false,
    itemsCents: 3200,
    shippingCents: 524,
    subtotalCents: 3200,
    holidayEligibleCents: 3200,
    ...overrides,
  });

function sums() {
  /* ---- Florida sales tax ---- */
  assert.equal(Object.keys(FL_SURTAX_BPS).length, 67);
  assert.equal(floridaCounty("32832"), "Orange");
  assert.equal(floridaCounty("33139-1234"), "Miami-Dade");
  assert.equal(floridaCounty("32084"), "St. Johns");
  assert.equal(floridaCounty("99999"), null);
  ok("every Florida county has a surtax rate and ZIP codes map to counties");

  assert.deepEqual(
    { cents: tax({}).taxCents, rate: tax({}).rateBps, county: tax({}).county },
    { cents: 242, rate: 650, county: "Orange" },
  );
  assert.equal(tax({ postalCode: "33139" }).taxCents, 261); // Miami-Dade, 7%
  assert.equal(tax({ postalCode: "34429", itemsCents: 5045, shippingCents: 0, subtotalCents: 5045 }).taxCents, 303); // Citrus, 6%: the state's own example
  ok("tax is 6% plus the delivery county's surtax, on items and shipping, rounded as Florida rounds");

  assert.equal(tax({ itemsCents: 2560 }).taxCents, Math.round(((2560 + 524) * 650) / 10_000));
  ok("a discount comes off before the tax");

  assert.deepEqual(
    { cents: tax({ state: "GA", postalCode: "30301" }).taxCents, why: tax({ state: "GA", postalCode: "30301" }).exempt },
    { cents: 0, why: "out_of_state" },
  );
  assert.equal(tax({ state: "Florida" }).taxCents, 242);
  assert.equal(tax({ state: "", postalCode: "", pickup: true }).county, "Orange");
  ok("out-of-state orders owe Florida nothing, and a pickup is taxed at home");

  const unknown = tax({ postalCode: "39999" });
  assert.deepEqual({ rate: unknown.rateBps, known: unknown.countyKnown }, { rate: 700, known: false });
  ok("a ZIP code not in the table is taxed at the common rate and marked as a guess");

  assert.equal(tax({ day: "2026-08-01" }).taxCents, 0);
  assert.equal(tax({ day: "2026-08-01" }).exempt, "holiday");
  assert.equal(tax({ day: "2026-07-19" }).taxCents, 242);
  assert.equal(tax({ day: "2026-08-21" }).taxCents, 242);
  // Half the order is an item over $100: half the items and half the shipping are taxed.
  const mixed = tax({ day: "2026-08-01", itemsCents: 24000, subtotalCents: 24000, holidayEligibleCents: 12000, shippingCents: 600 });
  assert.equal(mixed.taxableCents, 12300);
  ok("clothing at $100 or less is tax-free from July 20 to August 20");

  /* ---- Federal set-aside ---- */
  const thirty = federalSetAside(30_000_00, 1200);
  assert.equal(thirty.selfEmploymentCents, 4238_87); // 30,000 x 0.9235 x 15.3%
  assert.equal(thirty.incomeTaxCents, Math.round((30_000_00 - 4238_86.5 / 2) * 0.8 * 0.12));
  assert.equal(federalSetAside(400_00, 2200).selfEmploymentCents, 0); // under $400 of earnings
  assert.equal(federalSetAside(-500_00, 2200).totalCents, 0);
  const big = federalSetAside(300_000_00, 2400);
  assert.equal(big.selfEmploymentCents, Math.round(184_500_00 * 0.124 + 300_000_00 * 0.9235 * 0.029));
  ok("self-employment tax and income tax on a share follow the 2026 rules");

  /* ---- Days and repeating costs ---- */
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.ok(isDay("2026-02-28") && !isDay("2026-02-30") && !isDay("10/09/2026"));
  assert.equal(dayOf(new Date("2026-10-10T03:30:00Z")), "2026-10-09"); // 11:30pm in Orlando
  const monthly = { id: "r", name: "Vercel", category: "SUBSCRIPTIONS", amountCents: 2000, every: "MONTH" as const, startsOn: "2026-01-31", endsOn: null };
  assert.deepEqual(occurrences(monthly, "2026-04-15"), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.deepEqual(occurrences({ ...monthly, endsOn: "2026-02-10" }, "2026-04-15"), ["2026-01-31"]);
  assert.deepEqual(occurrences({ ...monthly, every: "YEAR", startsOn: "2025-03-01" }, "2026-04-15"), ["2025-03-01", "2026-03-01"]);
  assert.deepEqual(occurrences({ ...monthly, startsOn: "2026-05-01" }, "2026-04-15"), []);
  ok("days follow the store's clock and a subscription is charged once a month from its first day");

  /* ---- The books ---- */
  const one = summarize(buildBooks(facts({ orders: [order({})] }), NOW));
  // $37.24 in. Out: $2.42 tax, $11.00 goods, $1.38 card fee (2.9% + 30c).
  assert.deepEqual(
    [one.moneyInCents, one.salesTaxCents, one.goodsCents, one.feesCents, one.netSalesCents, one.grossProfitCents, one.netProfitCents],
    [3724, 242, 1100, 138, 3482, 2382, 2244],
  );
  assert.equal(one.moneyInCents - one.moneyOutCents, one.netProfitCents);
  assert.ok(one.hasEstimates);
  ok("one order: money in, tax, goods and card fee add up to the profit");

  const exact = summarize(buildBooks(facts({ orders: [order({ costCents: 1425, processingFeeCents: 131 })] }), NOW));
  assert.deepEqual([exact.goodsCents, exact.feesCents, exact.hasEstimates], [1425, 131, false]);
  const shipped = summarize(buildBooks(facts({ orders: [order({})], assumptions: { ...DEFAULT_ASSUMPTIONS, shipCostCents: 475 } }), NOW));
  assert.equal(shipped.goodsCents, 1575);
  ok("the printer's bill and Square's real fee replace the stand-ins");

  const collected = summarize(buildBooks(facts({ orders: [order({ taxCents: 242, totalCents: 3966 })] }), NOW));
  assert.deepEqual([collected.taxCollectedCents, collected.salesTaxCents, collected.netSalesCents], [242, 242, 3724]);
  ok("tax charged at checkout is passed straight on and is never profit");

  const refunded = summarize(
    buildBooks(
      facts({ orders: [order({})], refunds: [{ orderNumber: "VS-TEST0001", at: new Date("2026-10-06T16:00:00Z"), amountCents: 1000 }] }),
      NOW,
    ),
  );
  // $10 back to the customer, and 65c of the tax with it (242 x 1000 / 3724).
  assert.deepEqual([refunded.refundsCents, refunded.salesTaxCents, refunded.netProfitCents], [1000, 177, 2244 - 1000 + 65]);
  const never = summarize(
    buildBooks(
      facts({
        orders: [order({ neverMade: true })],
        refunds: [{ orderNumber: "VS-TEST0001", at: new Date("2026-10-06T16:00:00Z"), amountCents: 3724 }],
      }),
      NOW,
    ),
  );
  assert.deepEqual([never.goodsCents, never.salesTaxCents, never.netProfitCents], [0, 0, -138]);
  ok("a refund takes its share of the tax back, and an order never made costs nothing to make");

  const gift = summarize(buildBooks(facts({ orders: [order({ provider: "No charge" })] }), NOW));
  assert.deepEqual([gift.moneyInCents, gift.goodsCents, gift.netProfitCents, gift.orders], [0, 1100, -1100, 0]);
  const cash = summarize(buildBooks(facts({ orders: [order({ provider: "Cash", pickup: true, shippingCents: 0, totalCents: 3200, state: "", postalCode: "" })] }), NOW));
  assert.deepEqual([cash.feesCents, cash.salesTaxCents], [0, 208]);
  ok("a giveaway is a cost with no sale, and cash has no card fee");

  const missing = summarize(buildBooks(facts({ orders: [order({ itemsCostCents: 0, linesWithoutCost: 1 })] }), NOW));
  assert.deepEqual([missing.goodsCents, missing.ordersWithoutCost], [0, 1]);
  ok("an order with no cost recorded is counted and flagged");

  const busy = buildBooks(
    facts({
      orders: [order({}), order({ orderNumber: "VS-TEST0002", paidAt: new Date("2026-09-20T16:00:00Z") })],
      expenses: [
        { id: "e1", spentOn: "2026-10-02", category: "ADS", amountCents: 2000, description: "Instagram" },
        { id: "e2", spentOn: "2026-12-01", category: "ADS", amountCents: 9999, description: "Not yet" },
      ],
      recurring: [{ id: "r1", name: "Vercel", category: "SUBSCRIPTIONS", amountCents: 500, every: "MONTH", startsOn: "2026-08-15", endsOn: null }],
    }),
    NOW,
  );
  const october = summarize(busy, { from: "2026-10-01", to: "2026-10-09" });
  // The subscription falls on the 15th, which hasn't come yet in October.
  assert.deepEqual([october.orders, october.expenses.ADS, october.expenses.SUBSCRIPTIONS ?? 0, october.netProfitCents], [1, 2000, 0, 244]);
  const all = summarize(busy);
  assert.deepEqual([all.orders, all.expensesCents, all.netProfitCents], [2, 2000 + 1000, 2244 * 2 - 3000]);
  const months = byMonth(busy, "2026-10-09", 3);
  assert.deepEqual(months.map((row) => [row.month, row.profitCents]), [["2026-08", -500], ["2026-09", 2244 - 500], ["2026-10", 244]]);
  assert.equal(months.reduce((total, row) => total + row.profitCents, 0), all.netProfitCents);
  ok("expenses and subscriptions land on their own days, and the months add up to the whole");

  /* ---- Shares and balances ---- */
  const from0 = [{ shareBps: 3333, effectiveOn: "2000-01-01", createdAt: 1 }];
  assert.equal(shareOf(10_000, 3333), 3333);
  assert.equal(shareOf(2244, 3333), 747); // 747.92 rounds down
  assert.ok(shareOf(2244, 3333) * 3 <= 2244);
  assert.equal(shareOf(-1000, 3333), -334); // a loss is shared too, and rounds against the partner
  const single = statementFor(busy, "2026-10-09", { shares: from0, payouts: [], adjustments: [] });
  assert.equal(single.earnedCents, shareOf(all.netProfitCents, 3333));
  assert.equal(single.availableCents, single.earnedCents);
  ok("a third of the profit, rounded down so three thirds never exceed the whole");

  const paid = statementFor(busy, "2026-10-09", {
    shares: from0,
    payouts: [
      { amountCents: 200, status: "SENT" },
      { amountCents: 100, status: "REQUESTED" },
      { amountCents: 5000, status: "CANCELLED" },
    ],
    adjustments: [{ amountCents: -50, reason: "x", day: "2026-10-01", addedBy: "t" }],
  });
  assert.deepEqual(
    [paid.paidCents, paid.pendingCents, paid.adjustmentsCents, paid.balanceCents],
    [200, 100, -50, single.earnedCents - 350],
  );
  const over = statementFor(busy, "2026-10-09", { shares: from0, payouts: [{ amountCents: 99_999, status: "SENT" }], adjustments: [] });
  assert.ok(over.balanceCents < 0);
  assert.equal(over.availableCents, 0);
  ok("cash-outs and corrections come off the balance, cancelled ones don't, and it never goes below $0 available");

  // The share changes on October 1: September at 33.33%, October at 50%.
  const changed = [...from0, { shareBps: 5000, effectiveOn: "2026-10-01", createdAt: 2 }];
  const split = statementFor(busy, "2026-10-09", { shares: changed, payouts: [], adjustments: [] });
  const before = summarize(busy, { to: "2026-09-30" }).netProfitCents;
  assert.deepEqual(
    split.stretches.map((stretch) => [stretch.from, stretch.to, stretch.shareBps, stretch.shareCents]),
    [
      ["2000-01-01", "2026-09-30", 3333, shareOf(before, 3333)],
      ["2026-10-01", null, 5000, shareOf(244, 5000)],
    ],
  );
  assert.equal(shareOn(changed, "2026-09-30"), 3333);
  assert.equal(shareOn(changed, "2026-10-01"), 5000);
  assert.equal(shareOn(changed, "1999-12-31"), 0);
  assert.equal(earnedIn(busy, changed, { from: "2026-01-01", to: "2026-10-09" }), split.earnedCents);
  assert.equal(earnedIn(busy, changed, { from: "2026-10-01", to: "2026-10-09" }), shareOf(244, 5000));
  // Set twice on the same day: the later setting is the one that counts.
  assert.equal(shareOn([...changed, { shareBps: 4000, effectiveOn: "2026-10-01", createdAt: 3 }], "2026-10-05"), 4000);
  ok("a changed share applies from its day on and leaves earlier profit alone");

  assert.equal(parseDollars("$1,250.5"), 125050);
  assert.equal(parseDollars("12.345"), null);
  assert.equal(parseDollars("-5"), null);
  ok("typed amounts are read as dollars and cents, or refused");
}

async function database() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url || !/localhost|127\.0\.0\.1/.test(url)) {
    console.log("  --  database checks skipped (DATABASE_URL is not a local scratch database)");
    return;
  }
  const db = getDb();
  const tag = randomUUID().slice(0, 8);
  const email = (name: string) => `acct-${tag}-${name}@example.com`;
  const today = dayOf(new Date());
  const adminIds: string[] = [];
  const orderNumbers: string[] = [];

  // Whatever shares the scratch database already has are set aside for the run,
  // so the checks start from nobody holding any, and put back afterwards.
  const setAside = await db.select().from(profitShares);
  await db.delete(profitShares);
  // Orders other test runs left behind have no cost, which would put every
  // cash-out on hold. They are given one for the run and cleared again after.
  const costed = await db
    .update(orders)
    .set({ costCents: 0 })
    .where(isNull(orders.costCents))
    .returning({ id: orders.id });

  const cleanup = async () => {
    if (adminIds.length) {
      await db.delete(partnerPayouts).where(inArray(partnerPayouts.adminId, adminIds));
      await db.delete(payoutAdjustments).where(inArray(payoutAdjustments.adminId, adminIds));
      await db.delete(profitShares).where(inArray(profitShares.adminId, adminIds));
      await db.delete(adminInvites).where(inArray(adminInvites.adminId, adminIds));
      await db.delete(adminUsers).where(inArray(adminUsers.id, adminIds));
    }
    await db.delete(adminUsers).where(like(adminUsers.email, `acct-${tag}-%`));
    if (orderNumbers.length) await db.delete(orders).where(inArray(orders.orderNumber, orderNumbers));
    await db.delete(customers).where(like(customers.email, `acct-${tag}-%`));
    await db.delete(webhookEvents).where(like(webhookEvents.eventId, `acct-${tag}-%`));
    await db.delete(expenses).where(like(expenses.description, `acct-${tag}%`));
    await db.delete(recurringCosts).where(like(recurringCosts.name, `acct-${tag}%`));
    if (setAside.length) await db.insert(profitShares).values(setAside).onConflictDoNothing();
    if (costed.length) {
      await db.update(orders).set({ costCents: null }).where(inArray(orders.id, costed.map((row) => row.id)));
    }
  };

  try {
    const [a, b] = await db
      .insert(adminUsers)
      .values([
        { email: email("a"), name: "Partner A", passwordHash: "x", role: "STAFF" },
        { email: email("b"), name: "Partner B", passwordHash: "x", role: "STAFF" },
      ])
      .returning({ id: adminUsers.id });
    adminIds.push(a.id, b.id);
    await db.insert(profitShares).values({ adminId: a.id, shareBps: 2500, effectiveOn: today, setBy: "test" });

    const pay = async (name: string, subtotalCents: number) => {
      const result = await recordPaidOrder(db, {
        event: { provider: "test", id: `acct-${tag}-${name}`, type: "payment.updated" },
        paymentRef: `acct-${tag}-${name}`,
        paymentProvider: "square",
        email: email("buyer"),
        customerName: "Buyer",
        phone: null,
        currency: "usd",
        subtotalCents,
        discountCents: 0,
        shippingCents: 0,
        taxCents: 0,
        totalCents: subtotalCents,
        shippingName: "Buyer",
        shippingAddress: { line1: "1 Peach St", city: "Atlanta", state: "GA", postalCode: "30301", country: "US" },
        shippingMethod: "Standard shipping",
        items: [{ slug: "t", productName: "Test tee", colorName: "Black", size: "M", quantity: 1, unitPriceCents: subtotalCents }],
      });
      assert.equal(result.status, "created");
      const number = (result as { orderNumber: string }).orderNumber;
      orderNumbers.push(number);
      return number;
    };

    const start = await loadPayoutState(db);
    const profitBefore = start.partners.find((partner) => partner.id === a.id)?.statement.stretches[0]?.profitCents ?? 0;

    // A $100 order to Georgia: no Florida tax, $3.20 card fee, $40 to make.
    const number = await pay("one", 100_00);
    await setOrderCost(db, number, "test", 40_00);
    const delta = 100_00 - (290 + 30) - 40_00;
    let state = await loadPayoutState(db);
    let mine = state.partners.find((partner) => partner.id === a.id)!;
    assert.equal(mine.statement.stretches[0].profitCents, profitBefore + delta);
    assert.equal(mine.statement.earnedCents, shareOf(profitBefore + delta, 2500));
    const other = state.partners.find((partner) => partner.id === b.id)!;
    assert.deepEqual([other.shares.length, other.statement.availableCents], [0, 0]);
    ok("a paid order shows up in a partner's balance at their share, and someone with no share earns nothing");

    const facts = await loadFacts(db);
    const fact = facts.orders.find((row) => row.orderNumber === number)!;
    assert.deepEqual([fact.costCents, fact.state, fact.units, fact.linesWithoutCost], [4000, "GA", 1, 1]);
    ok("the books read the order's cost, where it shipped and what was on it");

    // An order nobody has costed yet would count as pure profit, so cashing out waits for it.
    const uncosted = await pay("three", 30_00);
    await assert.rejects(requestPayout(db, a.id), /no cost recorded/);
    await setOrderCost(db, uncosted, "test", 30_00 - (87 + 30)); // costs exactly what it made
    ok("nobody can cash out while an order's cost is unknown");

    // A refund Square accepted and then failed never left the account, so it isn't in the books.
    const [refundedOrder] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, uncosted));
    await db.insert(orderEvents).values([
      { orderId: refundedOrder.id, type: "order.refunded", message: "Refunded $5.00", data: { refundId: `acct-${tag}-r1`, amountCents: 500 } },
      { orderId: refundedOrder.id, type: "order.attention", message: "Square could not complete a refund", data: { refundId: `acct-${tag}-r1` } },
      { orderId: refundedOrder.id, type: "order.refunded", message: "Refunded $2.00", data: { refundId: `acct-${tag}-r2`, amountCents: 200 } },
    ]);
    const withRefunds = await loadFacts(db);
    assert.deepEqual(withRefunds.refunds.filter((row) => row.orderNumber === uncosted).map((row) => row.amountCents), [200]);
    await db.delete(orderEvents).where(eq(orderEvents.orderId, refundedOrder.id));
    ok("a refund that failed at Square is not counted");

    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;

    // Make sure there is something to cash out whatever else is in the scratch database.
    if (mine.statement.availableCents < 500) {
      await addAdjustment(db, a.id, 500 - mine.statement.availableCents, "top up for the test", "test");
      state = await loadPayoutState(db);
      mine = state.partners.find((partner) => partner.id === a.id)!;
    }
    const available = mine.statement.availableCents;
    assert.ok(available >= 500);

    // Two cash-outs at the same moment: one gets the money, the other finds nothing left.
    const attempts = await Promise.allSettled([requestPayout(db, a.id), requestPayout(db, a.id)]);
    const won = attempts.filter((attempt) => attempt.status === "fulfilled");
    const lost = attempts.filter((attempt) => attempt.status === "rejected");
    assert.deepEqual([won.length, lost.length], [1, 1]);
    assert.ok((lost[0] as PromiseRejectedResult).reason instanceof PayoutError);
    const payout = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof requestPayout>>>).value;
    assert.equal(payout.amountCents, available);
    assert.equal((payout.receipt as { statement: { availableCents: number } }).statement.availableCents, available);
    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;
    assert.deepEqual([mine.statement.availableCents, mine.statement.pendingCents], [0, available]);
    ok("cashing out takes the whole balance once, keeps a receipt, and leaves $0");

    await assert.rejects(requestPayout(db, b.id), PayoutError);
    ok("someone with nothing available can't cash out");

    // The next sale starts the balance again from zero.
    const second = await pay("two", 50_00);
    await setOrderCost(db, second, "test", 20_00);
    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;
    const grown = mine.statement.availableCents;
    assert.ok(grown > 0 && grown <= shareOf(50_00 - (145 + 30) - 20_00, 2500) + 1);
    ok("after a cash-out the balance builds again from the next sale only");

    // A cost added after the cash-out pulls the balance below zero: nothing is available.
    await addExpense(db, "test", { spentOn: today, category: "ADS", amountCents: 500_00, description: `acct-${tag} ads` });
    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;
    assert.ok(mine.statement.balanceCents < 0);
    assert.equal(mine.statement.availableCents, 0);
    await assert.rejects(requestPayout(db, a.id), PayoutError);
    await db.delete(expenses).where(like(expenses.description, `acct-${tag}%`));
    ok("a cost that arrives after a cash-out is carried, not paid out twice");

    // Cancelling gives the money back; sending settles it. Each can only happen once.
    await cancelPayout(db, payout.id, "Master", "wrong amount");
    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;
    assert.equal(mine.statement.availableCents, available + grown);
    await assert.rejects(markPayoutSent(db, payout.id, "Master", ""), PayoutError);
    const again = await requestPayout(db, a.id);
    assert.equal(again.amountCents, available + grown);
    const sent = await markPayoutSent(db, again.id, "Master", "Zelle");
    assert.deepEqual([sent.status, sent.note, sent.closedBy], ["SENT", "Zelle", "Master"]);
    await assert.rejects(cancelPayout(db, again.id, "Master", ""), PayoutError);
    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;
    assert.deepEqual([mine.statement.paidCents, mine.statement.pendingCents, mine.statement.availableCents], [available + grown, 0, 0]);
    ok("a cancelled cash-out goes back on the balance; a sent one is final");

    // Shares.
    const taken = state.partners.reduce((total, partner) => total + (partner.id === b.id ? 0 : partner.statement.currentShareBps), 0);
    await assert.rejects(setShare(db, b.id, 10_000 - taken + 1, "Master"), PayoutError);
    await assert.rejects(setShare(db, b.id, -1, "Master"), PayoutError);
    assert.equal(taken, 2500);
    await setShare(db, b.id, 7500, "Master");
    state = await loadPayoutState(db);
    assert.equal(state.partners.find((partner) => partner.id === b.id)!.statement.currentShareBps, 7500);
    await assert.rejects(setShare(db, a.id, 2501, "Master"), /the most this share can be is 25%/);
    assert.ok(state.partners.reduce((total, partner) => total + partner.statement.currentShareBps, 0) <= 10_000);
    ok("shares can be changed but can never add up to more than 100%");

    await assert.rejects(addAdjustment(db, a.id, 0, "nothing", "Master"), PayoutError);
    await assert.rejects(addAdjustment(db, a.id, 500, "  ", "Master"), PayoutError);
    await addAdjustment(db, a.id, 1234, "Paid for samples", "Master");
    state = await loadPayoutState(db);
    mine = state.partners.find((partner) => partner.id === a.id)!;
    assert.equal(mine.statement.availableCents, 1234);
    assert.equal(mine.statement.adjustments.at(-1)?.reason, "Paid for samples");
    ok("a correction needs an amount and a reason, and shows on the receipt");

    // Repeating costs.
    await addRecurring(db, "test", { name: `acct-${tag} sub`, category: "SUBSCRIPTIONS", amountCents: 700, every: "MONTH", startsOn: addMonths(today, -2) });
    let after = await loadFacts(db);
    const sub = after.recurring.find((row) => row.name === `acct-${tag} sub`)!;
    assert.equal(occurrences(sub, today).length, 3);
    await endRecurring(db, sub.id, addMonths(today, -1));
    after = await loadFacts(db);
    assert.equal(occurrences(after.recurring.find((row) => row.id === sub.id)!, today).length, 2);
    await endRecurring(db, sub.id, addMonths(today, -3));
    after = await loadFacts(db);
    assert.equal(after.recurring.find((row) => row.id === sub.id), undefined);
    ok("a subscription counts each month until it is stopped");

    // Taking access away.
    assert.equal(await setAccess(db, b.id, false), true);
    await assert.rejects(requestPayout(db, b.id), PayoutError);
    const team = await listTeam(db);
    assert.equal(team.find((member) => member.id === b.id)?.disabled, true);
    const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.role, "OWNER")).limit(1);
    if (owner) assert.equal(await setAccess(db, owner.id, false), false);
    ok("access can be taken from a partner but never from the master account");

    await invitations(tag, adminIds);
  } finally {
    await cleanup();
  }
}

/** Needs the email stand-in, so the link in the invitation can be read back. */
async function invitations(tag: string, adminIds: string[]) {
  const api = process.env.RESEND_API_URL;
  if (!api || !process.env.RESEND_API_KEY) {
    console.log("  --  invitation checks skipped (no email stand-in)");
    return;
  }
  const { acceptInvite, createInvite, readInvite, sendInvite, sendPendingInvites, InviteError } = await import("../src/lib/admin/invites");
  const { verifyPassword } = await import("../src/lib/admin/passwords");
  const db = getDb();
  const address = `acct-${tag}-new@example.com`;
  const linkFor = async () => {
    const sent = (await (await fetch(`${api}/_sent`)).json()) as { to: string[]; html: string }[];
    const mine = sent.filter((mail) => mail.to[0] === address);
    const match = mine.at(-1)?.html.match(/\/admin\/join\?code=([A-Za-z0-9_-]+)/);
    assert.ok(match, "the invitation email has a link in it");
    return { token: match[1], count: mine.length };
  };

  const id = await createInvite({ name: "New Person", email: ` ${address.toUpperCase()} ` }, "Master");
  adminIds.push(id);
  await assert.rejects(createInvite({ name: "Again", email: address }, "Master"), InviteError);
  assert.equal(await readInvite("x".repeat(43)), null);

  // Waiting to be sent: the timed job picks it up, once.
  assert.ok((await sendPendingInvites()) >= 1);
  const first = await linkFor();
  assert.equal(first.count, 1);
  await sendPendingInvites();
  assert.equal((await linkFor()).count, 1);
  assert.deepEqual(await readInvite(first.token), { name: "New Person", email: address });
  ok("an invitation is emailed once, with a link only that person has");

  // Sending again replaces the link.
  assert.equal(await sendInvite(id), true);
  const second = await linkFor();
  assert.notEqual(second.token, first.token);
  assert.equal(await readInvite(first.token), null);
  assert.equal(await acceptInvite(first.token, "Hacker", "a-long-enough-password"), null);
  ok("sending it again cancels the earlier link");

  // An expired link is no good.
  await db.update(adminInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(adminInvites.adminId, id));
  assert.equal(await acceptInvite(second.token, "New Person", "a-long-enough-password"), null);
  await db.update(adminInvites).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(adminInvites.adminId, id));

  // Two people using the same link at once: only one gets in.
  const results = await Promise.all([
    acceptInvite(second.token, "Nia Person", "correct horse battery"),
    acceptInvite(second.token, "Nia Person", "correct horse battery"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const [joined] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  assert.deepEqual([joined.name, joined.email, joined.role], ["Nia Person", address, "STAFF"]);
  assert.ok(await verifyPassword("correct horse battery", joined.passwordHash));
  assert.equal(joined.totpEnabledAt, null); // still has to set up the authenticator app
  assert.equal(await readInvite(second.token), null);
  assert.equal(await acceptInvite(second.token, "Again", "another-long-password"), null);
  assert.equal(await sendInvite(id), false);
  ok("the link sets the name and password once, and never works again");

  // Someone whose access was removed before they joined can't use their link.
  const blockedId = await createInvite({ name: "Blocked", email: `acct-${tag}-blocked@example.com` }, "Master");
  adminIds.push(blockedId);
  await setAccess(db, blockedId, false);
  assert.equal(await sendInvite(blockedId), false);
  ok("no invitation goes to someone whose access has been removed");
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
