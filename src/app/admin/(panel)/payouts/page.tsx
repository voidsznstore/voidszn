import type { Metadata } from "next";
import { Suspense } from "react";
import { MoneyRow, MoneyRows } from "@/components/admin/money-rows";
import { Loading, PageHeader } from "@/components/admin/page-header";
import {
  AdjustForm,
  CashOutButton,
  HandleForm,
  SettlePayoutForm,
  ShareForm,
  TaxRateForm,
} from "@/components/admin/payout-forms";
import { PayoutReceipt } from "@/components/admin/payout-receipt";
import { getDb } from "@/db";
import { type Partner, type Payout, type Receipt, loadPayoutState } from "@/db/queries/payouts";
import { yearOf } from "@/lib/accounting/days";
import { MIN_PAYOUT_CENTS, earnedIn, formatShare } from "@/lib/accounting/payouts";
import { FEDERAL, federalSetAside } from "@/lib/accounting/tax";
import { formatDateTime } from "@/lib/admin/format";
import { isMaster, requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Payouts" };

export default function PayoutsPage() {
  return (
    <>
      <PageHeader title="Payouts" />
      <Suspense fallback={<Loading />}>
        <Payouts />
      </Suspense>
    </>
  );
}

const panel = "panel flex flex-col gap-4 p-5";

const STATUS: Record<string, { label: string; tone: string }> = {
  REQUESTED: { label: "Waiting to be sent", tone: "tag-warn" },
  SENT: { label: "Sent", tone: "tag-good" },
  CANCELLED: { label: "Cancelled", tone: "tag-mute" },
};

const RATES = FEDERAL.brackets.map((bracket) => ({
  bps: bracket.bps,
  label: `${bracket.bps / 100}% (single, income over $${bracket.singleFrom.toLocaleString("en-US")})`,
}));

function receiptOf(payout: Payout): Receipt | null {
  const receipt = payout.receipt as Partial<Receipt> | null;
  return receipt?.statement?.summary ? (receipt as Receipt) : null;
}

function PayoutLine({ payout, who }: { payout: Payout; who?: string }) {
  const status = STATUS[payout.status] ?? STATUS.REQUESTED;
  const receipt = receiptOf(payout);
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold text-bone">
            {who ? `${who}: ` : ""}
            <span className="num">{formatMoney(payout.amountCents)}</span>
          </p>
          <p className="text-[0.8125rem] text-smoke">
            Cashed out {formatDateTime(payout.requestedAt)}
            {payout.sentAt ? ` · sent ${formatDateTime(payout.sentAt)}` : ""}
            {payout.cancelledAt ? ` · cancelled ${formatDateTime(payout.cancelledAt)}` : ""}
            {payout.closedBy ? ` by ${payout.closedBy}` : ""}
            {payout.destination ? ` · to ${payout.destination}` : ""}
          </p>
          {payout.note ? <p className="text-[0.8125rem] text-bone-dim">{payout.note}</p> : null}
        </div>
        <span className={`tag ${status.tone}`}>{status.label}</span>
      </div>
      {receipt ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">Receipt</summary>
          <div className="well mt-1 !rounded-field p-4">
            <PayoutReceipt statement={receipt.statement} cashedOutCents={payout.amountCents} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

async function Payouts() {
  const admin = await requireAdmin();
  const { books, today, partners } = await loadPayoutState(getDb());
  const me = partners.find((partner) => partner.id === admin.id);
  const master = isMaster(admin);
  const year = yearOf(today);

  return (
    <div className="flex flex-col gap-8">
      {me && me.shares.length > 0 ? <Mine me={me} books={books} today={today} year={year} /> : (
        <p className="notice max-w-2xl px-4 py-3 text-sm">
          This account doesn&apos;t have a share of the profit yet.
          {master ? " Set one below." : " The master account sets it."}
        </p>
      )}
      {master ? <Everyone partners={partners} meId={admin.id} /> : null}
    </div>
  );
}

function Mine({
  me,
  books,
  today,
  year,
}: {
  me: Partner;
  books: Awaited<ReturnType<typeof loadPayoutState>>["books"];
  today: string;
  year: number;
}) {
  const s = me.statement;
  const costsMissing = s.summary.ordersWithoutCost;
  const canCashOut = s.availableCents >= MIN_PAYOUT_CENTS && costsMissing === 0;
  const yearShare = earnedIn(books, me.shares, { from: `${year}-01-01`, to: today });
  const tax = federalSetAside(yearShare, me.incomeTaxBps);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="flex flex-col gap-6">
        <section className="glass flex flex-col gap-4 rounded-card p-6">
          <div>
            <p className="label text-smoke">Available to cash out</p>
            <p className="num text-5xl font-semibold text-white">{formatMoney(s.availableCents)}</p>
            <p className="pt-1 text-sm text-bone-dim">
              Your {formatShare(s.currentShareBps)} of the profit, less what you&apos;ve already taken.
            </p>
          </div>
          {s.pendingCents > 0 ? (
            <p className="notice px-4 py-3 text-sm">
              {formatMoney(s.pendingCents)} is cashed out and waiting to be sent to you.
            </p>
          ) : null}
          {costsMissing > 0 ? (
            <p className="notice px-4 py-3 text-sm">
              {costsMissing} {costsMissing === 1 ? "order has" : "orders have"} no cost recorded, so the real profit
              isn&apos;t known and cashing out is on hold. Set what each product costs on its product page, or type
              the printer&apos;s bill on the order. The Accounting screen shows which.
            </p>
          ) : null}
          <CashOutButton amount={formatMoney(s.availableCents)} disabled={!canCashOut} />
          <p className="text-[0.8125rem] text-smoke">
            Cashing out takes the whole balance and sets it back to $0.00. It fills up again with every sale.
            {s.balanceCents < 0
              ? ` You are ${formatMoney(-s.balanceCents)} behind, because refunds or costs came in after your last cash-out. New profit covers that first.`
              : ""}
          </p>
        </section>

        <section className={panel}>
          <div>
            <h2 className="text-xl font-semibold text-white">Where it goes</h2>
            <p className="text-sm text-smoke">
              Instant payouts to a card aren&apos;t switched on yet. Until they are, a cash-out goes to the master
              account to send by hand, and shows here as sent once it has gone.
            </p>
          </div>
          <div className="well flex items-center justify-between gap-4 !rounded-field px-4 py-3">
            <span className="text-sm text-bone-dim">Debit card</span>
            <span className="tag tag-mute">Not connected</span>
          </div>
          <HandleForm handle={me.payoutHandle ?? ""} />
        </section>

        <section className={panel}>
          <div>
            <h2 className="text-xl font-semibold text-white">Keep back for taxes</h2>
            <p className="text-sm text-smoke">
              {year} so far. Nothing is held back from your payouts: this is what to keep aside yourself. Federal tax
              is owed on your share of the profit whether or not you have cashed it out. Florida has no income tax.
            </p>
          </div>
          <MoneyRows label="Tax to keep back">
            <MoneyRow label={`Your share of this year's profit`} cents={Math.max(0, yearShare)} />
            <MoneyRow
              label="Self-employment tax"
              cents={tax.selfEmploymentCents}
              note={
                tax.selfEmploymentCents === 0 && yearShare > 0
                  ? "None until your share for the year passes about $433"
                  : "15.3% of 92.35% of your share"
              }
            />
            <MoneyRow
              label={`Income tax at ${formatShare(me.incomeTaxBps)}`}
              cents={tax.incomeTaxCents}
              note="After the 20% business income deduction"
            />
            <MoneyRow label="Keep back" cents={tax.totalCents} grand />
          </MoneyRows>
          <TaxRateForm rate={me.incomeTaxBps} rates={RATES} />
          <p className="text-[0.8125rem] text-smoke">
            Pick the bracket your other income already puts you in. This is a planning figure, not tax advice.
          </p>
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <section className={panel}>
          <div>
            <h2 className="text-xl font-semibold text-white">How your balance is worked out</h2>
            <p className="text-sm text-smoke">Every figure since the store opened, down to what you can take today.</p>
          </div>
          <PayoutReceipt statement={s} />
        </section>

        <section className={panel}>
          <h2 className="text-xl font-semibold text-white">Past payouts</h2>
          {me.payouts.length === 0 ? (
            <p className="text-sm text-smoke">Nothing cashed out yet.</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {me.payouts.map((payout) => (
                <PayoutLine key={payout.id} payout={payout} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** The master account's view: everyone's balance, and the controls to change them. */
function Everyone({ partners, meId }: { partners: Partner[]; meId: string }) {
  const waiting = partners.flatMap((partner) =>
    partner.payouts.filter((payout) => payout.status === "REQUESTED").map((payout) => ({ partner, payout })),
  );
  const totalShare = partners.reduce((total, partner) => total + partner.statement.currentShareBps, 0);

  return (
    <section className="flex flex-col gap-6 border-t border-line pt-8">
      <div>
        <h2 className="display text-3xl text-white">Everyone&apos;s payouts</h2>
        <p className="text-sm text-smoke">Only the master account sees this part and can change it.</p>
      </div>

      <div className={panel}>
        <h3 className="text-xl font-semibold text-white">Waiting to be sent</h3>
        {waiting.length === 0 ? (
          <p className="text-sm text-smoke">Nothing is waiting.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {waiting.map(({ partner, payout }) => (
              <li key={payout.id} className="well flex flex-col gap-3 !rounded-field p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-lg font-semibold text-white">
                    {partner.name}: <span className="num">{formatMoney(payout.amountCents)}</span>
                  </p>
                  <p className="text-sm text-bone-dim">
                    {payout.destination ? `Send to ${payout.destination}` : "They haven't said where to send it"}
                  </p>
                </div>
                <p className="text-[0.8125rem] text-smoke">Cashed out {formatDateTime(payout.requestedAt)}</p>
                <SettlePayoutForm id={payout.id} summary={`${formatMoney(payout.amountCents)} to ${partner.name}`} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={panel}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-xl font-semibold text-white">Where everyone stands</h3>
          <p className="text-sm text-smoke">
            Shares add up to {formatShare(totalShare)}
            {totalShare < 10_000 ? `. The other ${formatShare(10_000 - totalShare)} stays in the business.` : "."}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-xs text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Who</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Share</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Earned</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Sent</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Waiting</th>
                <th scope="col" className="py-3 text-right font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => (
                <tr key={partner.id} className="border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-semibold">
                    {partner.name}
                    {partner.id === meId ? <span className="font-normal text-smoke"> (you)</span> : null}
                    {!partner.joined ? <span className="tag tag-accent ml-2">Invited</span> : null}
                    {partner.disabled ? <span className="tag tag-mute ml-2">Access removed</span> : null}
                  </th>
                  <td className="num py-3 pr-4 text-right">{formatShare(partner.statement.currentShareBps)}</td>
                  <td className="num py-3 pr-4 text-right">
                    {formatMoney(partner.statement.earnedCents + partner.statement.adjustmentsCents)}
                  </td>
                  <td className="num py-3 pr-4 text-right">{formatMoney(partner.statement.paidCents)}</td>
                  <td className="num py-3 pr-4 text-right">{formatMoney(partner.statement.pendingCents)}</td>
                  <td className="num py-3 text-right font-semibold text-white">
                    {formatMoney(partner.statement.availableCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {partners.map((partner) => (
        <details key={partner.id} className="panel p-5">
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-3">
            <span className="text-xl font-semibold text-white">{partner.name}</span>
            <span className="text-sm link">Receipt, share and corrections</span>
          </summary>
          <div className="flex flex-col gap-6 pt-4">
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <h4 className="font-semibold text-white">Share</h4>
                  <ShareForm adminId={partner.id} percent={(partner.statement.currentShareBps / 100).toString()} />
                  <p className="text-[0.8125rem] text-smoke">
                    A new share counts from today. Profit made before today keeps the split it was made under.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="font-semibold text-white">Correct the balance</h4>
                  <AdjustForm adminId={partner.id} />
                  <p className="text-[0.8125rem] text-smoke">
                    Adds to or takes from what {partner.name} can cash out. The reason shows on their receipt.
                  </p>
                </div>
              </div>
              <div className="well !rounded-field p-4">
                <PayoutReceipt statement={partner.statement} />
              </div>
            </div>
            {partner.payouts.length > 0 ? (
              <div>
                <h4 className="font-semibold text-white">Payouts</h4>
                <ul className="flex flex-col border-t border-line">
                  {partner.payouts.map((payout) => (
                    <PayoutLine key={payout.id} payout={payout} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </section>
  );
}
