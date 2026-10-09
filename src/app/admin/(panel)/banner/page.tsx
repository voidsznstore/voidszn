import type { Metadata } from "next";
import { Suspense } from "react";
import { BannerForm } from "@/components/admin/banner-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/session";
import { getBannerForAdmin } from "@/lib/banner";

export const metadata: Metadata = { title: "Banner" };

export default function BannerPage() {
  return (
    <>
      <PageHeader title="Banner" />
      <Suspense fallback={<Loading />}>
        <BannerSettings />
      </Suspense>
    </>
  );
}

async function BannerSettings() {
  await requireAdmin();
  return <BannerForm banner={await getBannerForAdmin(getDb())} />;
}
