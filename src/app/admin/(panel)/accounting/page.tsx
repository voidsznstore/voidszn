import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AssumptionsForm, CollectTaxSwitch, ExpenseForm, RecurringForm } from "@/components/admin/accounting-forms";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { MoneyRow, MoneyRows, TextRow } from "@/components/admin/money-rows";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { getAssumptions, listExpenses, listRecurring } from "@/db/queries/accounting";
import { loadPayoutState } from "@/db/queries/payouts";
import { categoryLabel, EXPENSE_CATEGORIES } from "@/lib/accounting/categories";
import { type Range, addMonths, formatDay, formatMonth, formatMonthShort, inRange, monthOf, yearOf } from "@/lib/accounting/days";
import { byMonth, summarize } from "@/lib/accounting/ledger";
import { earnedIn, formatShare } from "@/lib/accounting/payouts";
import { FEDERAL, TAX_FIGURES_YEAR, federalSetAside } from "@/lib/accounting/tax";
import { isMaster, requireAdmin } from "@/lib/admin/session";
import { getTaxSettings } from "@/lib/checkout/tax";
import { formatMoney } from "@/lib/money";
import { deleteExpenseAction, deleteRecurringAction, endRecurringAction } from "./actions";

export const metadata: Metadata = { title: "Accounting" };

type Props = PageProps<"/admin/accounting">;

const PERIODS = { month: "This month", last: "Last month", year: "This year", all: "All time" } as const;
type Period = keyof typeof PERIODS;

export default function AccountingPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader title="Accounting" />
      <Suspense fallback={<Loading />}>
        <Accounting searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const panel = "panel flex flex-col gap-4 p-5";
const percentOf = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "n/a");

function rangeFor(period: Period, today: string): Range {
  const first = `${monthOf(today)}-01`;
  if (period === "month") return { from: first, to: today };
  if (period === "last") {
    const lastDay = new Date(`${first}T12:00:00Z`);
    lastDay.setUTCDate(0);
    return { from: addMonths(first, -1), to: lastDay.toISOString().slice(0, 10) };
  }
  if (period === "year") return { from: `${yearOf(today)}-01-01`, to: today };
  return {};
}

/** The next quarterly estimated tax payment on or after today. */
function nextEstimatedDue(today: string): string {
  const year = yearOf(today);
  const dates = [`${year}-01-15`, `${year}-04-15`, `${year}-06-15`, `${year}-09-15`, `${year + 1}-01-15`];
  return dates.find((date) => date >= today) ?? dates[dates.length - 1];
}

async function Accounting({ searchParams }: Pick<Props, "searchParams">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const asked = Array.isArray(params.period) ? params.period[0] : params.period;
  const period: Period = asked && asked in PERIODS ? (asked as Period) : "month";

  const db = getDb();
  const [{ books, today, partners }, expenses, recurring, assumptions, taxSettings] = await Promise.all([
    loadPayoutState(db),
    listExpenses(db),
    listRecurring(db),
    getAssumptions(db),
    getTaxSettings(db),
  ]);

  const range = rangeFor(period, today);
  const s = summarize(books, range);
  // The last twelve months, starting from the first one with anything in it.
  const year12 = byMonth(books, today, 12);
  const firstBusy = year12.findIndex((row) => row.inCents !== 0 || row.outCents !== 0);
  const months = year12.slice(firstBusy < 0 ? year12.length - 1 : Math.min(firstBusy, year12.length - 1));
  const scale = Math.max(1, ...months.map((row) => Math.max(row.inCents, row.outCents)));
  const lines = books.lines.filter((line) => inRange(line.day, range)).reverse();
  const shownLines = lines.slice(0, 80);

  // Tax is a yearly matter, so this part always covers the calendar year so far.
  const yearRange: Range = { from: `${yearOf(today)}-01-01`, to: today };
  const year = summarize(books, yearRange);
  // Each partner's bracket is their own business: the master account sees everyone, others see themselves.
  const master = isMaster(admin);
  const sharers = partners.filter(
    (partner) => partner.shares.length > 0 && !partner.disabled && (master || partner.id === admin.id),
  );
  const setAsides = sharers.map((partner) => {
    const shareCents = earnedIn(books, partner.shares, yearRange);
    return { partner, shareCents, tax: federalSetAside(shareCents, partner.incomeTaxBps) };
  });
  const federalCents = setAsides.reduce((total, row) => total + row.tax.totalCents, 0);
  // Some of this year's Florida orders were paid before tax was charged at checkout.
  const partlyCollected = year.salesTaxCents > year.taxCollectedCents;

  const tiles: [string, string, string?][] = [
    ["Money in", formatMoney(s.moneyInCents), "Everything customers paid"],
    ["Money out", formatMoney(s.moneyOutCents), "Refunds, tax, goods, fees, expenses"],
    ["Net profit", formatMoney(s.netProfitCents), `${percentOf(s.netProfitCents, s.netSalesCents)} of net sales`],
    ["Gross profit", formatMoney(s.grossProfitCents), `${percentOf(s.grossProfitCents, s.netSalesCents)} margin`],
    ["Orders", String(s.orders), `${s.units} ${s.units === 1 ? "item" : "items"}`],
    ["Average order", s.orders > 0 ? formatMoney(Math.round(s.moneyInCents / s.orders)) : "n/a"],
  ];

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as Period[]).map((key) => (
          <Link
            key={key}
            href={`/admin/accounting?period=${key}`}
            aria-current={key === period ? "page" : undefined}
            className="chip"
          >
            {PERIODS[key]}
          </Link>
        ))}
      </nav>

      <ul className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {tiles.map(([label, value, note]) => (
          <li key={label} className="panel flex flex-col gap-1.5 p-5">
            <span className="label text-smoke">{label}</span>
            <span className="num text-3xl font-semibold text-white">{value}</span>
            {note ? <span className="text-[0.8125rem] text-smoke">{note}</span> : null}
          </li>
        ))}
      </ul>

      {s.ordersWithoutCost > 0 ? (
        <p className="notice px-4 py-3 text-sm">
          {s.ordersWithoutCost} {s.ordersWithoutCost === 1 ? "order has" : "orders have"} no cost recorded, so the
          profit here is higher than it really is. Set what each product costs on its product page, or type the
          printer&apos;s bill on the order.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={panel}>
          <div>
            <h2 className="text-xl font-semibold text-white">How the money works out</h2>
            <p className="text-sm text-smoke">
              {PERIODS[period]}
              {range.from ? `: ${formatDay(range.from)} to ${formatDay(range.to ?? today)}` : ""}. Paid orders only.
            </p>
          </div>
          <MoneyRows label="Profit and loss">
            <MoneyRow label="Items sold" cents={s.salesCents} />
            {s.discountsCents > 0 ? <MoneyRow label="Discounts given" cents={s.discountsCents} minus /> : null}
            <MoneyRow label="Shipping charged" cents={s.shippingCents} />
            {s.taxCollectedCents > 0 ? <MoneyRow label="Sales tax collected" cents={s.taxCollectedCents} /> : null}
            <MoneyRow label="Money in" cents={s.moneyInCents} total />
            <MoneyRow label="Refunds" cents={s.refundsCents} minus />
            <MoneyRow
              label="Sales tax owed"
              cents={s.salesTaxCents}
              minus
              note="Belongs to the state, not the store"
            />
            <MoneyRow label="Net sales" cents={s.netSalesCents} total />
            <MoneyRow label="Cost of goods" cents={s.goodsCents} minus note="What the printer charged to make and send the orders" />
            <MoneyRow
              label="Gross profit"
              cents={s.grossProfitCents}
              total
              note={`${percentOf(s.grossProfitCents, s.netSalesCents)} of net sales`}
            />
            <MoneyRow label="Card processing fees" cents={s.feesCents} minus />
            {Object.keys(EXPENSE_CATEGORIES).map((category) =>
              (s.expenses[category] ?? 0) > 0 || category === "ADS" || category === "SUBSCRIPTIONS" ? (
                <MoneyRow key={category} label={categoryLabel(category)} cents={s.expenses[category] ?? 0} minus />
              ) : null,
            )}
            <MoneyRow
              label="Net profit"
              cents={s.netProfitCents}
              grand
              note={`${percentOf(s.netProfitCents, s.netSalesCents)} of net sales. This is what gets split.`}
            />
          </MoneyRows>
          {s.hasEstimates ? (
            <p className="text-[0.8125rem] text-smoke">
              Some figures are stand-ins until the real ones are known: card fees before Square reports them, and
              costs taken from the product instead of the printer&apos;s bill.
            </p>
          ) : null}
        </section>

        <section className={panel}>
          <div>
            <h2 className="text-xl font-semibold text-white">Put aside for taxes</h2>
            <p className="text-sm text-smoke">{yearOf(today)} so far, whichever period is picked above.</p>
          </div>
          <CollectTaxSwitch on={taxSettings.collect} canChange={master} />
          <MoneyRows label="Tax to put aside">
            <MoneyRow
              label="Florida sales tax"
              cents={year.salesTaxCents}
              note={
                !taxSettings.collect
                  ? "Not charged at checkout, so it comes out of each Florida sale. Already taken off the profit."
                  : partlyCollected
                    ? "Charged at checkout now. On orders from before that, it came out of the sale. Already taken off the profit."
                    : "Collected at checkout and passed on. Already taken off the profit."
              }
            />
            {setAsides.map(({ partner, shareCents, tax }) => (
              <MoneyRow
                key={partner.id}
                label={`${partner.name}: federal tax`}
                cents={tax.totalCents}
                note={`On a ${formatMoney(Math.max(0, shareCents))} share: ${formatMoney(tax.selfEmploymentCents)} self-employment tax, ${formatMoney(tax.incomeTaxCents)} income tax at ${formatShare(partner.incomeTaxBps)}`}
              />
            ))}
            <MoneyRow
              label="To put aside this year so far"
              cents={year.salesTaxCents + federalCents}
              grand
              note={master ? undefined : "The sales tax and your own federal tax. Each partner sees their own."}
            />
          </MoneyRows>
          <ul className="flex flex-col gap-1.5 text-sm text-bone-dim">
            <li>
              The sales tax is the business&apos;s to send to Florida. The federal tax is each partner&apos;s own, paid
              from their payouts, and is owed on their share whether or not they have cashed it out.
            </li>
            <li>Next quarterly estimated payment to the IRS: {formatDay(nextEstimatedDue(today))}.</li>
          </ul>
          <details className="border-t border-line pt-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">
              How this is worked out, and the dates that matter
            </summary>
            <div className="flex flex-col gap-3 pt-2 text-sm text-bone-dim">
              <p>
                <strong className="text-white">Florida sales tax.</strong> 6% plus the surtax of the county the order
                is delivered to (Orange County is 0.5%, so 6.5% at home). It is charged on the price after any
                discount, and on shipping too. Orders sent out of state owe Florida nothing. Clothing at $100 or less
                is tax-free each year from July 20 to August 20. A store in Florida has to register with the
                Department of Revenue (Form DR-1, online) before its first sale and charge it from then on; if
                it isn&apos;t charged, the store still owes it. Checkout works the tax out from the delivery address
                with these same rules.
              </p>
              <p>
                <strong className="text-white">Sending it in.</strong> Returns are due on the 1st of the month after
                each period and late after the 20th. How often depends on how much tax was sent in over the last
                year: monthly above $1,000, quarterly up to $1,000, twice a year up to $500, once a year up to $100.
                Filing and paying online on time keeps 2.5% of the first $1,200 of tax, up to $30 a return. A late
                return costs 10% of what was due, and at least $50.
              </p>
              <p>
                <strong className="text-white">Other states.</strong> A Florida store doesn&apos;t owe another
                state&apos;s sales tax until it sells a lot there, in most states $100,000 in a year.
              </p>
              <p>
                <strong className="text-white">Income tax.</strong> Florida has no personal income tax. A business with
                several owners is taxed as a partnership unless it has chosen otherwise: it pays no income tax itself,
                files Form 1065 by March 15, and gives each partner a Schedule K-1. Each partner then pays
                self-employment tax (15.3% of 92.35% of their share) and income tax at their own rate, after the 20%
                business income deduction. Each partner picks their rate on the Payouts screen.
              </p>
              <p>
                <strong className="text-white">Paying as you go.</strong> Anyone who will owe $1,000 or more for the
                year pays in four parts: {FEDERAL.estimatedDue.map((date) => formatDay(`2026-${date}`).replace(", 2026", "")).join(", ")}.
              </p>
              <p>
                <strong className="text-white">Each year.</strong> A Florida LLC files its annual report by May 1
                ($138.75, or $538.75 late).
              </p>
              <p className="text-smoke">
                Rates are for {TAX_FIGURES_YEAR} and are checked against the Florida Department of Revenue, the IRS and
                Social Security. This is arithmetic to plan with, not tax advice: it can&apos;t see a partner&apos;s
                other income, and it assumes a partnership. Have an accountant confirm before filing.
              </p>
            </div>
          </details>
        </section>
      </div>

      <section className={panel}>
        <h2 className="text-xl font-semibold text-white">Month by month</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-xs text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Month</th>
                <th scope="col" className="w-2/5 py-3 pr-4 font-medium">In and out</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Money in</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Money out</th>
                <th scope="col" className="py-3 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.month} className="border-b border-line">
                  <th scope="row" className="whitespace-nowrap py-3 pr-4 font-semibold">
                    {formatMonthShort(row.month)}
                  </th>
                  <td className="py-3 pr-4" aria-hidden="true">
                    <span className="flex flex-col gap-1">
                      <span className="block h-2 rounded-full bg-bone" style={{ width: `${(row.inCents / scale) * 100}%`, minWidth: row.inCents > 0 ? 3 : 0 }} />
                      <span className="block h-2 rounded-full bg-accent" style={{ width: `${(row.outCents / scale) * 100}%`, minWidth: row.outCents > 0 ? 3 : 0 }} />
                    </span>
                  </td>
                  <td className="num py-3 pr-4 text-right">{formatMoney(row.inCents)}</td>
                  <td className="num py-3 pr-4 text-right">{formatMoney(row.outCents)}</td>
                  <td className={`num py-3 text-right font-semibold ${row.profitCents < 0 ? "text-ember" : "text-white"}`}>
                    {formatMoney(row.profitCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-smoke">
          <span className="inline-flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-bone" />Money in</span>
          <span className="inline-flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-accent" />Money out</span>
        </p>
      </section>

      <section className={panel}>
        <div>
          <h2 className="text-xl font-semibold text-white">Expenses</h2>
          <p className="text-sm text-smoke">
            Anything the business paid for that isn&apos;t one order: ads, samples, filing fees. It comes off the
            profit on the day it was spent, and off everyone&apos;s payout with it. Anyone can add one; only the
            master account can take one out.
          </p>
        </div>
        <ExpenseForm today={today} />
        {expenses.length > 0 ? (
          <ul className="flex flex-col border-t border-line">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-bone">{expense.description}</p>
                  <p className="text-[0.8125rem] text-smoke">
                    {formatDay(expense.spentOn)} · {categoryLabel(expense.category)} · added by {expense.addedBy}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="num">{formatMoney(expense.amountCents)}</span>
                  {master ? (
                    <form action={deleteExpenseAction}>
                      <input type="hidden" name="id" value={expense.id} />
                      <ConfirmButton label="Delete" confirmLabel="Delete it" />
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line pt-4 text-sm text-smoke">No expenses yet.</p>
        )}
      </section>

      <section className={panel}>
        <div>
          <h2 className="text-xl font-semibold text-white">Subscriptions</h2>
          <p className="text-sm text-smoke">
            Costs that repeat. Each one is counted on the day of its first charge and again every month or year,
            without anyone having to enter it.
          </p>
        </div>
        <RecurringForm today={today} />
        {recurring.length > 0 ? (
          <ul className="flex flex-col border-t border-line">
            {recurring.map((cost) => {
              const ended = cost.endsOn !== null && cost.endsOn <= today;
              return (
                <li key={cost.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-bone">
                      {cost.name} {ended ? <span className="tag tag-mute ml-1">Ended</span> : null}
                    </p>
                    <p className="text-[0.8125rem] text-smoke">
                      {categoryLabel(cost.category)} · since {formatDay(cost.startsOn)}
                      {cost.endsOn ? ` · last charge by ${formatDay(cost.endsOn)}` : ""} · added by {cost.addedBy}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="num">
                      {formatMoney(cost.amountCents)} <span className="text-smoke">/ {cost.every === "YEAR" ? "year" : "month"}</span>
                    </span>
                    {master && !ended ? (
                      <form action={endRecurringAction}>
                        <input type="hidden" name="id" value={cost.id} />
                        <button type="submit" className="btn btn-glass btn-sm">Stop from today</button>
                      </form>
                    ) : null}
                    {master ? (
                      <form action={deleteRecurringAction}>
                        <input type="hidden" name="id" value={cost.id} />
                        <ConfirmButton label="Delete" confirmLabel="Delete, with its past charges" />
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t border-line pt-4 text-sm text-smoke">No subscriptions yet.</p>
        )}
      </section>

      <section className={panel}>
        <div>
          <h2 className="text-xl font-semibold text-white">Money in and out</h2>
          <p className="text-sm text-smoke">
            {PERIODS[period]}, newest first.
            {lines.length > shownLines.length ? ` Showing the latest ${shownLines.length} of ${lines.length} lines.` : ""}
          </p>
        </div>
        {shownLines.length === 0 ? (
          <p className="text-sm text-smoke">Nothing in {period === "all" ? "the books yet" : formatMonth(range.from ?? today)}.</p>
        ) : (
          <ul className="flex flex-col">
            {shownLines.map((line, index) => (
              <li key={index} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-bone">{line.label}</span>
                  {line.estimated ? <span className="text-smoke"> (estimate)</span> : null}
                  <span className="block text-[0.8125rem] text-smoke">
                    {formatDay(line.day)}
                    {line.orderNumber ? (
                      <>
                        {" · "}
                        <Link href={`/admin/orders/${line.orderNumber}`} className="link">
                          {line.orderNumber}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className={`num flex-none ${line.amountCents < 0 ? "text-bone-dim" : "text-white"}`}>
                  {line.amountCents < 0 ? `−${formatMoney(-line.amountCents)}` : `+${formatMoney(line.amountCents)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={panel}>
        <div>
          <h2 className="text-xl font-semibold text-white">Stand-in figures</h2>
          <p className="text-sm text-smoke">
            Used only until the real figure is known. Square reports its real fee a few minutes after each payment
            and that replaces the card fee here. The printer&apos;s shipping is added to an order&apos;s cost until
            someone types in the real bill on the order. The payout fees are what Stripe charges the business each
            time a partner is paid to their card; check them against Stripe&apos;s monthly bill.
          </p>
        </div>
        {master ? (
          <AssumptionsForm value={assumptions} />
        ) : (
          <MoneyRows label="Stand-in figures">
            <TextRow label="Card fee" value={`${assumptions.feeBps / 100}% + ${formatMoney(assumptions.feeFixedCents)}`} />
            <MoneyRow label="Printer's shipping per order" cents={assumptions.shipCostCents} />
            <TextRow
              label="Card payout fee"
              value={`${assumptions.payoutFeeBps / 100}% + ${formatMoney(assumptions.payoutFeeFixedCents)}`}
            />
            <MoneyRow label="Per partner paid by card, a month" cents={assumptions.payoutAccountCents} />
          </MoneyRows>
        )}
      </section>
    </div>
  );
}
