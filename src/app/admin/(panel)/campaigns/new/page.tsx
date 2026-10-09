import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NewCampaignEditor } from "@/components/admin/campaign-editor";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { listMarketingRecipients } from "@/db/queries/admin-customers";
import { campaignBlocker } from "@/lib/admin/campaign-setup";
import { requireAdmin } from "@/lib/admin/session";
import { isStorageConfigured } from "@/lib/storage";

export const metadata: Metadata = { title: "New campaign" };

const BLANK = { subject: "", preheader: "", body: "", imageUrl: null, buttonLabel: "", buttonUrl: "" };

export default function NewCampaignPage() {
  return (
    <>
      <Link href="/admin/campaigns" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
        All campaigns
      </Link>
      <PageHeader title="New campaign" />
      <Suspense fallback={<Loading />}>
        <NewCampaign />
      </Suspense>
    </>
  );
}

async function NewCampaign() {
  const admin = await requireAdmin();
  const recipients = await listMarketingRecipients(getDb());
  return (
    <NewCampaignEditor
      content={BLANK}
      audience={recipients.length}
      testAddress={admin.email}
      canUpload={isStorageConfigured()}
      blocked={campaignBlocker()}
    />
  );
}
