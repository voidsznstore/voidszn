import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { listCampaigns } from "@/db/queries/admin-campaigns";
import { listMarketingRecipients } from "@/db/queries/admin-customers";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        action={
          <Link href="/admin/campaigns/new" className="btn btn-accent">
            New campaign
          </Link>
        }
      />
      <Suspense fallback={<Loading />}>
        <Campaigns />
      </Suspense>
    </>
  );
}

const STATUS = { DRAFT: "Draft", SENDING: "Part sent", SENT: "Sent" } as const;

async function Campaigns() {
  await requireAdmin();
  const db = getDb();
  const [campaigns, recipients] = await Promise.all([listCampaigns(db), listMarketingRecipients(db)]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-bone-dim">
        {recipients.length === 0
          ? "Nobody has agreed to get marketing emails yet."
          : `${recipients.length} ${recipients.length === 1 ? "person gets" : "people get"} your marketing emails.`}{" "}
        <Link href="/admin/customers?view=emails" className="underline underline-offset-4">
          See who
        </Link>
      </p>

      {campaigns.length === 0 ? (
        <p className="border border-line bg-ash-soft px-5 py-10 text-center text-bone-dim">
          No campaigns yet. Write one to tell people about a drop or a sale.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-xs text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Subject</th>
                <th scope="col" className="py-3 pr-4 font-medium">Status</th>
                <th scope="col" className="py-3 pr-4 font-medium">Sent to</th>
                <th scope="col" className="py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-b border-line hover:bg-ash-soft">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/campaigns/${campaign.id}`}
                      className="inline-flex min-h-11 items-center font-semibold text-white underline-offset-4 hover:underline"
                    >
                      {campaign.subject}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="label text-xs">{STATUS[campaign.status]}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {campaign.status === "DRAFT" ? "" : campaign.sends.sent}
                    {campaign.sends.pending > 0 ? (
                      <span className="ml-2 font-sans text-smoke">{campaign.sends.pending} waiting</span>
                    ) : null}
                    {campaign.sends.failed > 0 ? (
                      <span className="ml-2 font-sans text-accent">{campaign.sends.failed} failed</span>
                    ) : null}
                  </td>
                  <td className="py-2 text-bone-dim">
                    {formatDateTime(campaign.sentAt ?? campaign.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
