import { categoryLabel } from "@/lib/accounting/categories";
import { formatDay } from "@/lib/accounting/days";
import { type Statement, formatShare } from "@/lib/accounting/payouts";
import { MoneyRow, MoneyRows } from "./money-rows";

/**
 * Every step from what customers paid to what one partner can cash out, as a
 * receipt. Used live for the current balance and from the copy kept with each
 * past payout, so an old receipt always shows the figures as they were.
 */
export function PayoutReceipt({
  statement,
  /** For a past payout: the amount that was cashed out, shown as the last line. */
  cashedOutCents,
}: {
  statement: Statement;
  cashedOutCents?: number;
}) {
  const s = statement.summary;
  const expenseKeys = Object.keys(s.expenses).filter((key) => s.expenses[key] > 0);
  const single = statement.stretches.length === 1;
  // What had gone out before this payout, when looking at an old receipt.
  const before = statement.paidCents + statement.pendingCents;

  return (
    <MoneyRows label="How the payout is worked out">
      <MoneyRow label="Everything customers have paid" cents={s.moneyInCents} note="Items, less discounts, plus shipping" />
      <MoneyRow label="Refunds" cents={s.refundsCents} minus />
      <MoneyRow label="Sales tax owed" cents={s.salesTaxCents} minus />
      <MoneyRow label="Cost of goods" cents={s.goodsCents} minus note="What the printer charged" />
      <MoneyRow label="Card processing fees" cents={s.feesCents} minus />
      <MoneyRow label={categoryLabel("ADS")} cents={s.expenses.ADS ?? 0} minus />
      <MoneyRow label={categoryLabel("SUBSCRIPTIONS")} cents={s.expenses.SUBSCRIPTIONS ?? 0} minus />
      {expenseKeys
        .filter((key) => key !== "ADS" && key !== "SUBSCRIPTIONS")
        .map((key) => (
          <MoneyRow key={key} label={categoryLabel(key)} cents={s.expenses[key]} minus />
        ))}
      <MoneyRow label="The store's profit, all time" cents={s.netProfitCents} total />

      {statement.stretches.length === 0 ? (
        <MoneyRow label="Your share" cents={0} note="No share of the profit has been set for this account" />
      ) : single ? (
        <MoneyRow
          label={`Your share: ${formatShare(statement.stretches[0].shareBps)}`}
          cents={statement.earnedCents}
          total
        />
      ) : (
        <>
          {statement.stretches.map((stretch) => (
            <MoneyRow
              key={stretch.from}
              inset
              label={`${formatShare(stretch.shareBps)} of ${stretch.profitCents < 0 ? "a loss of " : ""}$${(Math.abs(stretch.profitCents) / 100).toFixed(2)}`}
              note={
                stretch.from < "2001-01-01"
                  ? `Up to ${stretch.to ? formatDay(stretch.to) : "today"}`
                  : `${formatDay(stretch.from)} ${stretch.to ? `to ${formatDay(stretch.to)}` : "onwards"}`
              }
              cents={stretch.shareCents}
            />
          ))}
          <MoneyRow label="Your share" cents={statement.earnedCents} total />
        </>
      )}

      {statement.adjustments.map((row, index) => (
        <MoneyRow
          key={index}
          label={row.amountCents > 0 ? "Added" : "Taken off"}
          note={`${row.reason} (${row.addedBy}, ${formatDay(row.day)})`}
          cents={row.amountCents}
        />
      ))}

      {cashedOutCents === undefined ? (
        <>
          <MoneyRow label="Already cashed out and sent" cents={statement.paidCents} minus />
          {statement.pendingCents > 0 ? (
            <MoneyRow label="Cashed out, waiting to be sent" cents={statement.pendingCents} minus />
          ) : null}
          <MoneyRow
            label="Available to cash out"
            cents={statement.availableCents}
            grand
            note={
              statement.balanceCents < 0
                ? `Behind by $${(-statement.balanceCents / 100).toFixed(2)}: refunds or costs came in after the last cash-out. New profit covers that first.`
                : undefined
            }
          />
        </>
      ) : (
        <>
          <MoneyRow label="Cashed out before this" cents={before} minus />
          <MoneyRow label="This payout" cents={cashedOutCents} grand />
        </>
      )}
    </MoneyRows>
  );
}
