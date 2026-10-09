import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ManualOrderForm } from "@/components/admin/manual-order-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { getCustomer } from "@/db/queries/admin-customers";
import { PAYMENT_METHODS, listOrderProducts } from "@/db/queries/admin-manual-orders";
import { requireAdmin } from "@/lib/admin/session";
import { isEmailConfigured } from "@/lib/email/send";

export const metadata: Metadata = { title: "Add order" };

type Props = PageProps<"/admin/orders/new">;

export default function NewOrderPage({ searchParams }: Props) {
  return (
    <>
      <Link href="/admin/orders" className="text-sm text-smoke link">
        All orders
      </Link>
      <PageHeader title="Add order" />
      <Suspense fallback={<Loading />}>
        <NewOrder searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function NewOrder({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const { customer: customerId } = await searchParams;
  const db = getDb();
  // Coming from a customer's page starts the order with their details filled in.
  const [products, known] = await Promise.all([
    listOrderProducts(db),
    typeof customerId === "string" && UUID.test(customerId) ? getCustomer(db, customerId) : null,
  ]);
  const address = known?.customer.defaultAddress;
  return (
    <ManualOrderForm
      products={products}
      paymentMethods={[...PAYMENT_METHODS]}
      canEmail={isEmailConfigured()}
      customer={
        known
          ? {
              name: known.customer.name ?? "",
              email: known.customer.email,
              phone: known.customer.phone ?? "",
              line1: address?.line1 ?? "",
              line2: address?.line2 ?? "",
              city: address?.city ?? "",
              state: address?.state ?? "",
              postalCode: address?.postalCode ?? "",
            }
          : undefined
      }
    />
  );
}
