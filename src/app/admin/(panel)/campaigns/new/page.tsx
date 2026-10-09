import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BLANK_CAMPAIGN, NewCampaignEditor } from "@/components/admin/campaign-editor";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { listMarketingRecipients } from "@/db/queries/admin-customers";
import { listUsableDiscounts } from "@/db/queries/admin-discounts";
import { toCampaignCode } from "@/lib/admin/campaign-codes";
import { campaignBlocker } from "@/lib/admin/campaign-setup";
import { requireAdmin } from "@/lib/admin/session";
import { isStorageConfigured } from "@/lib/storage";

export const metadata: Metadata = { title: "New campaign" };

export default function NewCampaignPage() {
  return (
    <>
      <Link href="/admin/campaigns" className="link text-sm text-smoke">
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
  const db = getDb();
  const [recipients, codes] = await Promise.all([listMarketingRecipients(db), listUsableDiscounts(db)]);
  return (
    <NewCampaignEditor
      content={BLANK_CAMPAIGN}
      codes={codes.map(toCampaignCode)}
      audience={recipients.length}
      testAddress={admin.email}
      canUpload={isStorageConfigured()}
      blocked={campaignBlocker()}
    />
  );
}
