import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CampaignTabs } from "@/components/admin/campaign-tabs";
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
      <CampaignTabs current="campaigns" />
      <p className="text-bone-dim">
        {recipients.length === 0
          ? "Nobody has agreed to get marketing emails yet."
          : `${recipients.length} ${recipients.length === 1 ? "person gets" : "people get"} your marketing emails.`}{" "}
        <Link href="/admin/customers?view=emails" className="link">
          See who
        </Link>
      </p>

      {campaigns.length === 0 ? (
        <div className="panel flex flex-col items-center gap-4 px-5 py-12 text-center text-bone-dim">
          <p className="max-w-md text-balance">
            No campaigns yet. Start from a template for a sale, new designs or a code, and
            change the words to yours.
          </p>
          <Link href="/admin/campaigns/new" className="btn btn-accent">
            New campaign
          </Link>
        </div>
      ) : (
        <div className="panel overflow-x-auto px-5 py-1">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Subject</th>
                <th scope="col" className="py-3 pr-4 font-medium">Status</th>
                <th scope="col" className="py-3 pr-4 font-medium">Sent to</th>
                <th scope="col" className="py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-b border-line hover:bg-white/[0.04]">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/campaigns/${campaign.id}`}
                      className="inline-flex min-h-11 items-center font-semibold text-white underline-offset-4 hover:underline"
                    >
                      {campaign.subject}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={campaign.status === "SENT" ? "tag tag-good" : campaign.status === "SENDING" ? "tag tag-warn" : "tag tag-mute"}>
                      {STATUS[campaign.status]}
                    </span>
                  </td>
                  <td className="num py-2 pr-4">
                    {campaign.status === "DRAFT" ? "" : campaign.sends.sent}
                    {campaign.sends.pending > 0 ? (
                      <span className="ml-2 text-smoke">{campaign.sends.pending} waiting</span>
                    ) : null}
                    {campaign.sends.failed > 0 ? (
                      <span className="ml-2 text-ember">{campaign.sends.failed} failed</span>
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
