import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BLANK_DISCOUNT, DiscountEditor } from "@/components/admin/discount-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { timeZoneName } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";

export const metadata: Metadata = { title: "Create code" };

export default function NewDiscountPage() {
  return (
    <>
      <Link href="/admin/discounts" className="link text-sm text-smoke">
        All discounts
      </Link>
      <PageHeader title="Create code" />
      <Suspense fallback={<Loading />}>
        <NewDiscount />
      </Suspense>
    </>
  );
}

async function NewDiscount() {
  await requireAdmin();
  return <DiscountEditor discount={BLANK_DISCOUNT} timeZoneName={timeZoneName()} />;
}
