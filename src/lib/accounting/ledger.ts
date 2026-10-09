import { categoryLabel } from "./categories";
import { type Day, type Range, addMonths, dayOf, inRange, monthOf } from "./days";
import { floridaSalesTax } from "./tax";

/**
 * The store's books, worked out fresh from the orders and the costs every time
 * they are looked at. Nothing here is stored: change an order's cost or add an
 * expense and every figure, and every partner's balance, follows.
 *
 * Money is integer cents throughout. A line's amount is positive for money
 * coming in and negative for money going out.
 */

/** What the books need to know about one paid order. */
export type OrderFact = {
  orderNumber: string;
  paidAt: Date;
  /** "square" for the website. For orders added by hand, how it was paid. */
  provider: string | null;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  state: string;
  postalCode: string;
  /** Handed over in person, so nothing was shipped. */
  pickup: boolean;
  units: number;
  /** Of the subtotal, how much was for items at or under the sales tax holiday cap. */
  holidayEligibleCents: number;
  /** The cost of the items whose cost is known. */
  itemsCostCents: number;
  /** How many lines on the order have no cost recorded. */
  linesWithoutCost: number;
  /** What the order really cost, when someone has typed it in from the printer's bill. */
  costCents: number | null;
  /** The card fee, once the processor has reported it. */
  processingFeeCents: number | null;
  /** Called off before it was sent to the printer, so nothing was made. */
  neverMade: boolean;
};

export type RefundFact = { orderNumber: string; at: Date; amountCents: number };
export type ExpenseFact = {
  id: string;
  spentOn: Day;
  category: string;
  amountCents: number;
  description: string;
};
export type RecurringFact = {
  id: string;
  name: string;
  category: string;
  amountCents: number;
  every: "MONTH" | "YEAR";
  startsOn: Day;
  endsOn: Day | null;
};

/** Figures used only when the real one isn't known yet. */
export type Assumptions = {
  /** The card fee, until the processor reports the real one: a percentage plus a fixed amount. */
  feeBps: number;
  feeFixedCents: number;
  /** What the printer charges to ship one order, on top of the items. */
  shipCostCents: number;
};

/** Square's rate for payments taken through its online API: 2.9% + 30¢. */
export const DEFAULT_ASSUMPTIONS: Assumptions = { feeBps: 290, feeFixedCents: 30, shipCostCents: 0 };

export type Facts = {
  orders: OrderFact[];
  refunds: RefundFact[];
  expenses: ExpenseFact[];
  recurring: RecurringFact[];
  assumptions: Assumptions;
};

export type LineKind =
  | "sales"
  | "discounts"
  | "shipping"
  | "taxCollected"
  | "refunds"
  | "salesTax"
  | "goods"
  | "fees"
  | "expense";

export type Line = {
  day: Day;
  /** For putting lines from the same day in order. */
  at: number;
  kind: LineKind;
  /** For expenses, which category. */
  category?: string;
  amountCents: number;
  label: string;
  orderNumber?: string;
  /** True when the real figure isn't known yet and this one stands in for it. */
  estimated?: boolean;
};

export type Books = {
  lines: Line[];
  /** One entry per paid order, for counting. */
  orders: { day: Day; orderNumber: string; units: number; costUnknown: boolean; charged: boolean }[];
};

/** An order given away. It brought no money in, but it still cost something to make. */
const NO_CHARGE = "No charge";

const noon = (day: Day) => Date.parse(`${day}T17:00:00Z`);

/** Every day a repeating cost has fallen due, up to and including `today`. */
export function occurrences(cost: RecurringFact, today: Day): Day[] {
  const last = cost.endsOn && cost.endsOn < today ? cost.endsOn : today;
  const step = cost.every === "YEAR" ? 12 : 1;
  const days: Day[] = [];
  // Counted from the start day each time, so a cost that starts on the 31st
  // falls on the last day of shorter months and goes back to the 31st after.
  for (let count = 0; count < 2400; count++) {
    const day = addMonths(cost.startsOn, count * step);
    if (day > last) break;
    days.push(day);
  }
  return days;
}

const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** Turns the raw facts into dated lines of money in and money out. */
export function buildBooks(facts: Facts, now: Date = new Date()): Books {
  const today = dayOf(now);
  const lines: Line[] = [];
  const orders: Books["orders"] = [];
  const taxByOrder = new Map<string, { owedCents: number; totalCents: number }>();

  for (const order of facts.orders) {
    const day = dayOf(order.paidAt);
    const at = order.paidAt.getTime();
    const ref = { day, at, orderNumber: order.orderNumber };
    const charged = order.provider !== NO_CHARGE;

    if (charged) {
      lines.push({ ...ref, kind: "sales", amountCents: order.subtotalCents, label: "Items sold" });
      if (order.discountCents > 0) {
        lines.push({ ...ref, kind: "discounts", amountCents: -order.discountCents, label: "Discount given" });
      }
      if (order.shippingCents > 0) {
        lines.push({ ...ref, kind: "shipping", amountCents: order.shippingCents, label: "Shipping charged" });
      }
      if (order.taxCents > 0) {
        lines.push({ ...ref, kind: "taxCollected", amountCents: order.taxCents, label: "Sales tax collected" });
      }

      // Sales tax. What was collected at checkout is owed in full. Where none was
      // collected, Florida is still owed its share of the price on Florida orders.
      let owedCents = order.taxCents;
      let taxLabel = "Sales tax collected, to pass on";
      let guessed = false;
      if (order.taxCents === 0) {
        const tax = floridaSalesTax({
          day,
          state: order.state,
          postalCode: order.postalCode,
          pickup: order.pickup,
          itemsCents: order.subtotalCents - order.discountCents,
          shippingCents: order.shippingCents,
          subtotalCents: order.subtotalCents,
          holidayEligibleCents: order.holidayEligibleCents,
        });
        owedCents = tax.taxCents;
        guessed = !tax.countyKnown;
        taxLabel = `Florida sales tax owed (${percent(tax.rateBps)}${tax.county ? `, ${tax.county} County` : ""})`;
      }
      if (owedCents > 0) {
        lines.push({ ...ref, kind: "salesTax", amountCents: -owedCents, label: taxLabel, estimated: guessed });
      }
      taxByOrder.set(order.orderNumber, { owedCents, totalCents: order.totalCents });

      // The card fee: the real one once it is known, the usual rate until then.
      if (order.provider === "square") {
        const known = order.processingFeeCents !== null;
        const fee = known
          ? (order.processingFeeCents as number)
          : Math.round((order.totalCents * facts.assumptions.feeBps) / 10_000) + facts.assumptions.feeFixedCents;
        if (fee !== 0) {
          lines.push({ ...ref, kind: "fees", amountCents: -fee, label: "Card processing fee", estimated: !known });
        }
      }
    }

    // What it cost to make and send. The typed-in bill wins. Otherwise the items'
    // own costs, plus the printer's usual shipping charge. Nothing if it was never made.
    const typed = order.costCents !== null;
    const cost = typed
      ? (order.costCents as number)
      : order.neverMade
        ? 0
        : order.itemsCostCents + (order.pickup ? 0 : facts.assumptions.shipCostCents);
    const costUnknown = !typed && !order.neverMade && order.linesWithoutCost > 0;
    if (cost > 0) {
      lines.push({ ...ref, kind: "goods", amountCents: -cost, label: "Cost to make and send", estimated: !typed });
    }
    orders.push({ day, orderNumber: order.orderNumber, units: order.units, costUnknown, charged });
  }

  for (const refund of facts.refunds) {
    const day = dayOf(refund.at);
    const ref = { day, at: refund.at.getTime(), orderNumber: refund.orderNumber };
    lines.push({ ...ref, kind: "refunds", amountCents: -refund.amountCents, label: "Refund" });
    // A refund takes the same share of the sales tax back with it.
    const tax = taxByOrder.get(refund.orderNumber);
    if (tax && tax.owedCents > 0 && tax.totalCents > 0) {
      const back = Math.round((tax.owedCents * Math.min(refund.amountCents, tax.totalCents)) / tax.totalCents);
      if (back > 0) {
        lines.push({ ...ref, kind: "salesTax", amountCents: back, label: "Sales tax no longer owed (refund)" });
      }
    }
  }

  for (const expense of facts.expenses) {
    if (expense.spentOn > today) continue;
    lines.push({
      day: expense.spentOn,
      at: noon(expense.spentOn),
      kind: "expense",
      category: expense.category,
      amountCents: -expense.amountCents,
      label: expense.description || categoryLabel(expense.category),
    });
  }

  for (const cost of facts.recurring) {
    for (const day of occurrences(cost, today)) {
      lines.push({
        day,
        at: noon(day),
        kind: "expense",
        category: cost.category,
        amountCents: -cost.amountCents,
        label: `${cost.name} (${cost.every === "YEAR" ? "yearly" : "monthly"})`,
      });
    }
  }

  lines.sort((a, b) => a.at - b.at);
  return { lines, orders };
}

/** The books for a stretch of days, added up. Every figure is zero or more. */
export type Summary = {
  /** Items at their price, before discounts. */
  salesCents: number;
  discountsCents: number;
  shippingCents: number;
  taxCollectedCents: number;
  /** Everything customers paid. */
  moneyInCents: number;

  refundsCents: number;
  /** Owed to the state. Not the store's money, whether or not it was charged separately. */
  salesTaxCents: number;
  goodsCents: number;
  feesCents: number;
  /** Expenses by category. */
  expenses: Record<string, number>;
  expensesCents: number;
  /** Everything that went out or is owed. */
  moneyOutCents: number;

  /** Money in, less refunds and sales tax. */
  netSalesCents: number;
  /** Net sales less what the goods cost. */
  grossProfitCents: number;
  /** Gross profit less fees and expenses. Can be negative. */
  netProfitCents: number;

  orders: number;
  units: number;
  /** Paid orders whose cost isn't known, so profit is overstated by that much. */
  ordersWithoutCost: number;
  /** True when any figure in here is standing in for one not known yet. */
  hasEstimates: boolean;
};

export function summarize(books: Books, range: Range = {}): Summary {
  const sum: Record<LineKind, number> = {
    sales: 0, discounts: 0, shipping: 0, taxCollected: 0, refunds: 0, salesTax: 0, goods: 0, fees: 0, expense: 0,
  };
  const expenses: Record<string, number> = {};
  let hasEstimates = false;

  for (const line of books.lines) {
    if (!inRange(line.day, range)) continue;
    sum[line.kind] += line.amountCents;
    if (line.estimated) hasEstimates = true;
    if (line.kind === "expense") {
      const category = line.category ?? "OTHER";
      expenses[category] = (expenses[category] ?? 0) - line.amountCents;
    }
  }

  const counted = books.orders.filter((order) => inRange(order.day, range));
  const moneyInCents = sum.sales + sum.discounts + sum.shipping + sum.taxCollected;
  const refundsCents = 0 - sum.refunds;
  const salesTaxCents = 0 - sum.salesTax;
  const goodsCents = 0 - sum.goods;
  const feesCents = 0 - sum.fees;
  const expensesCents = 0 - sum.expense;
  const netSalesCents = moneyInCents - refundsCents - salesTaxCents;
  const grossProfitCents = netSalesCents - goodsCents;

  return {
    salesCents: sum.sales,
    discountsCents: 0 - sum.discounts,
    shippingCents: sum.shipping,
    taxCollectedCents: sum.taxCollected,
    moneyInCents,
    refundsCents,
    salesTaxCents,
    goodsCents,
    feesCents,
    expenses,
    expensesCents,
    moneyOutCents: refundsCents + salesTaxCents + goodsCents + feesCents + expensesCents,
    netSalesCents,
    grossProfitCents,
    netProfitCents: grossProfitCents - feesCents - expensesCents,
    orders: counted.filter((order) => order.charged).length,
    units: counted.reduce((total, order) => total + order.units, 0),
    ordersWithoutCost: counted.filter((order) => order.costUnknown).length,
    hasEstimates,
  };
}

/** Profit for a stretch of days: every line in it, added up. */
export const profitIn = (books: Books, range: Range = {}) =>
  books.lines.reduce((total, line) => (inRange(line.day, range) ? total + line.amountCents : total), 0);

export type MonthRow = { month: string; inCents: number; outCents: number; profitCents: number };

/** Money in, money out and profit for each of the last `count` months, oldest first. */
export function byMonth(books: Books, today: Day, count = 12): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  for (let back = count - 1; back >= 0; back--) {
    const month = monthOf(addMonths(`${monthOf(today)}-01`, -back));
    rows.set(month, { month, inCents: 0, outCents: 0, profitCents: 0 });
  }
  for (const line of books.lines) {
    const row = rows.get(monthOf(line.day));
    if (!row) continue;
    const isIn = line.kind === "sales" || line.kind === "discounts" || line.kind === "shipping" || line.kind === "taxCollected";
    if (isIn) row.inCents += line.amountCents;
    else row.outCents -= line.amountCents;
    row.profitCents += line.amountCents;
  }
  return [...rows.values()];
}
