import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ManualOrderForm } from "@/components/admin/manual-order-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { PAYMENT_METHODS, listOrderProducts } from "@/db/queries/admin-manual-orders";
import { requireAdmin } from "@/lib/admin/session";
import { isEmailConfigured } from "@/lib/email/send";

export const metadata: Metadata = { title: "Add order" };

export default function NewOrderPage() {
  return (
    <>
      <Link href="/admin/orders" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
        All orders
      </Link>
      <PageHeader title="Add order" />
      <Suspense fallback={<Loading />}>
        <NewOrder />
      </Suspense>
    </>
  );
}

async function NewOrder() {
  await requireAdmin();
  const products = await listOrderProducts(getDb());
  return (
    <ManualOrderForm
      products={products}
      paymentMethods={[...PAYMENT_METHODS]}
      canEmail={isEmailConfigured()}
    />
  );
}
