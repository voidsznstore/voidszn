import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutomationForm } from "@/components/admin/automation-form";
import { CampaignTabs } from "@/components/admin/campaign-tabs";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { listUsableDiscounts } from "@/db/queries/admin-discounts";
import { countCarts } from "@/db/queries/carts";
import { campaignBlocker } from "@/lib/admin/campaign-setup";
import { requireAdmin } from "@/lib/admin/session";
import { discountSummary } from "@/lib/discounts/describe";
import { getAutomation } from "@/lib/email/automation";
import { AUTOMATIC_EMAILS } from "@/lib/email/samples";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Automatic emails" };

export default function AutomaticEmailsPage() {
  return (
    <>
      <PageHeader title="Campaigns" />
      <Suspense fallback={<Loading />}>
        <AutomaticEmails />
      </Suspense>
    </>
  );
}

async function AutomaticEmails() {
  await requireAdmin();
  const db = getDb();
  const [automation, codes, carts] = await Promise.all([
    getAutomation(db),
    listUsableDiscounts(db),
    countCarts(db),
  ]);
  const blocked = campaignBlocker();
  const orderEmails = AUTOMATIC_EMAILS.filter((email) => email.group === "orders");

  return (
    <div className="flex flex-col gap-6">
      <CampaignTabs current="automatic" />
      <p className="max-w-2xl text-bone-dim">
        Emails the store sends by itself. Every one matches the store, and each has a
        preview you can send to yourself.
      </p>

      {blocked ? <p className="notice p-3 text-sm text-bone-dim">{blocked} Cart reminders wait for the same thing.</p> : null}

      <ul className="grid gap-4 sm:grid-cols-3">
        {[
          ["Carts waiting", String(carts.waiting)],
          ["Reminded, last 30 days", String(carts.reminded)],
          ["Came back and ordered", carts.recovered > 0 ? `${carts.recovered} · ${formatMoney(carts.recoveredCents)}` : "0"],
        ].map(([label, value]) => (
          <li key={label} className="panel flex flex-col gap-1 p-4">
            <span className="label text-smoke">{label}</span>
            <span className="num text-2xl font-semibold text-white">{value}</span>
          </li>
        ))}
      </ul>

      <AutomationForm
        values={{
          enabled: automation.cart.enabled,
          steps: automation.cart.steps,
          deliveredCodeId: automation.delivered.discountCodeId,
        }}
        codes={codes.map((code) => ({ id: code.id, label: `${code.code} (${discountSummary(code)})` }))}
      />

      <section className="panel flex flex-col p-5">
        <h2 className="mb-1 text-lg font-semibold text-white">Order emails</h2>
        <p className="mb-3 text-bone-dim">These always go out. Nothing to switch on.</p>
        <ul>
          {orderEmails.map((email) => (
            <li key={email.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line py-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold text-white">{email.name}</span>
                <span className="text-sm text-smoke">{email.when}</span>
              </div>
              <Link href={`/admin/campaigns/automatic/${email.key}`} className="btn btn-glass btn-sm">
                Preview
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
