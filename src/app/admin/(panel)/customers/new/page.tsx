import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NewCustomerForm } from "@/components/admin/customer-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/admin/session";

export const metadata: Metadata = { title: "Add customer" };

const BLANK = {
  name: "",
  email: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  acceptsEmail: false,
  notes: "",
};

export default function NewCustomerPage() {
  return (
    <>
      <Link href="/admin/customers" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
        All customers
      </Link>
      <PageHeader title="Add customer" />
      <Suspense fallback={<Loading />}>
        <NewCustomer />
      </Suspense>
    </>
  );
}

async function NewCustomer() {
  await requireAdmin();
  return (
    <section className="flex max-w-xl flex-col gap-4 border border-line bg-ash-soft p-5">
      <NewCustomerForm customer={BLANK} />
    </section>
  );
}
