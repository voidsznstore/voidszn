import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { getOverview } from "@/db/queries/admin-overview";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <Suspense fallback={<Loading />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  await requireAdmin();
  const { toFulfil, week, flagged, recent } = await getOverview(getDb());

  const stats = [
    { label: "Orders to fulfil", value: String(toFulfil), href: "/admin/orders?view=to-fulfil" },
    { label: "Need attention", value: String(flagged), href: "/admin/orders?view=attention" },
    { label: "Orders, last 7 days", value: String(week.orders), href: "/admin/orders" },
    { label: "Sales, last 7 days", value: formatMoney(week.revenueCents), href: "/admin/orders" },
  ];

  return (
    <div className="flex flex-col gap-10">
      <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <li key={stat.label}>
            <Link
              href={stat.href}
              className="flex flex-col gap-2 panel p-5 transition-colors hover:border-line-strong"
            >
              <span className="label text-smoke">{stat.label}</span>
              <span className="num text-3xl font-semibold text-white">{stat.value}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section>
        <h2 className="label mb-3 text-xs text-smoke">Latest orders</h2>
        {recent.length === 0 ? (
          <p className="text-bone-dim">No orders yet.</p>
        ) : (
          <ul className="border-t border-line">
            {recent.map((order) => (
              <li key={order.orderNumber} className="border-b border-line">
                <Link
                  href={`/admin/orders/${order.orderNumber}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 hover:bg-white/[0.04]"
                >
                  <span className="font-mono text-sm text-white">{order.orderNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-bone-dim">{order.shippingName}</span>
                  <span className="label text-smoke">{order.status.replace("_", " ")}</span>
                  <span className="font-mono text-sm">{formatMoney(order.totalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
