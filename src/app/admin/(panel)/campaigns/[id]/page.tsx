import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CampaignEditor } from "@/components/admin/campaign-editor";
import { ContinueCampaignForm } from "@/components/admin/continue-campaign-form";
import { Loading } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { getCampaign } from "@/db/queries/admin-campaigns";
import { listMarketingRecipients } from "@/db/queries/admin-customers";
import { campaignBlocker } from "@/lib/admin/campaign-setup";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { campaignEmail } from "@/lib/email/templates";
import { isStorageConfigured } from "@/lib/storage";

export const metadata: Metadata = { title: "Campaign" };

type Props = PageProps<"/admin/campaigns/[id]">;

export default function CampaignPage({ params }: Props) {
  return (
    <>
      <Link href="/admin/campaigns" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
        All campaigns
      </Link>
      <Suspense fallback={<Loading />}>
        <Campaign params={params} />
      </Suspense>
    </>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const panel = "flex flex-col gap-4 border border-line bg-ash-soft p-5";
const heading = "text-lg font-semibold text-white";

async function Campaign({ params }: Pick<Props, "params">) {
  const admin = await requireAdmin();
  const { id } = await params;
  const db = getDb();
  const detail = UUID.test(id) ? await getCampaign(db, id) : null;
  if (!detail) notFound();

  const { campaign, sends, problems } = detail;
  const content = {
    subject: campaign.subject,
    preheader: campaign.preheader ?? "",
    body: campaign.body,
    imageUrl: campaign.imageUrl,
    buttonLabel: campaign.buttonLabel ?? "",
    buttonUrl: campaign.buttonUrl ?? "",
  };

  if (campaign.status === "DRAFT") {
    const recipients = await listMarketingRecipients(db);
    return (
      <>
        <h1 className="display mb-8 mt-2 text-4xl text-white">Draft campaign</h1>
        <CampaignEditor
          key={campaign.id}
          id={campaign.id}
          content={content}
          audience={recipients.length}
          testAddress={admin.email}
          canUpload={isStorageConfigured()}
          blocked={campaignBlocker()}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="mt-2 flex flex-col gap-2">
        <h1 className="display text-4xl text-white">{campaign.subject}</h1>
        <p className="text-sm text-smoke">
          {campaign.sentAt
            ? `Sent ${formatDateTime(campaign.sentAt)}`
            : `Started ${formatDateTime(campaign.updatedAt)}, not finished`}{" "}
          · by {campaign.createdBy}
        </p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              ["Sent", sends.sent],
              ["Still to send", sends.pending],
              ["Not sent", sends.failed + sends.skipped],
            ].map(([label, value]) => (
              <li key={label} className="flex flex-col gap-1 border border-line bg-ash-soft p-4">
                <span className="label text-xs text-smoke">{label}</span>
                <span className="font-mono text-xl text-white">{value}</span>
              </li>
            ))}
          </ul>

          {sends.pending > 0 ? (
            <section className={panel}>
              <h2 className={heading}>Not finished</h2>
              <p className="text-bone-dim">
                Sending stopped before everyone got it. Nobody is sent the same campaign twice.
              </p>
              <ContinueCampaignForm id={campaign.id} waiting={sends.pending} />
            </section>
          ) : null}

          {problems.length > 0 ? (
            <section className={panel}>
              <h2 className={heading}>Not sent</h2>
              <ul className="flex flex-col text-sm">
                {problems.map((problem) => (
                  <li key={problem.email} className="flex flex-col border-b border-line py-2 last:border-b-0">
                    <span>{problem.email}</span>
                    <span className="text-smoke">{problem.error ?? "Could not be sent"}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <section className={panel}>
          <h2 className={heading}>What was sent</h2>
          <iframe
            title="The email that was sent"
            sandbox=""
            srcDoc={campaignEmail(content, "#").html}
            className="h-[44rem] w-full border border-line bg-white"
          />
        </section>
      </div>
    </div>
  );
}
