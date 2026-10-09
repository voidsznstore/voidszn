import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { type CategorySales, getSalesByCategory } from "@/db/queries/admin-orders";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Sales" };

type Props = PageProps<"/admin/sales">;

const PERIODS = [7, 30, 90, 365];

export default function SalesPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader title="Sales by category" />
      <Suspense fallback={<Loading />}>
        <Sales searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function SalesTable({ title, help, rows }: { title: string; help: string; rows: CategorySales[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="text-sm text-smoke">{help}</p>
      </div>
      {rows.length === 0 ? (
        <p className="border border-line bg-ash-soft px-5 py-8 text-center text-bone-dim">
          Nothing sold in this period.
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="label border-b border-line text-xs text-smoke">
              <th scope="col" className="py-3 pr-4 font-medium">Category</th>
              <th scope="col" className="py-3 pr-4 text-right font-medium">Items sold</th>
              <th scope="col" className="py-3 text-right font-medium">Sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id ?? row.name} className="border-b border-line">
                <th scope="row" className="py-3 pr-4 font-semibold">
                  {row.id ? (
                    <Link href={`/admin/orders?category=${row.id}`} className="underline-offset-4 hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="text-smoke">{row.name}</span>
                  )}
                </th>
                <td className="py-3 pr-4 text-right font-mono">{row.units}</td>
                <td className="py-3 text-right font-mono">{formatMoney(row.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function Sales({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const requested = Number(Array.isArray(params.days) ? params.days[0] : params.days);
  const days = PERIODS.includes(requested) ? requested : 30;

  const { categories, total } = await getSalesByCategory(getDb(), days);

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {PERIODS.map((period) => (
          <Link
            key={period}
            href={`/admin/sales?days=${period}`}
            aria-current={period === days ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border px-4 text-sm font-semibold ${
              period === days ? "border-bone bg-bone text-void" : "border-line-strong hover:border-bone"
            }`}
          >
            Last {period === 365 ? "12 months" : `${period} days`}
          </Link>
        ))}
      </nav>

      <ul className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {[
          ["Sales", formatMoney(total.revenueCents)],
          ["Items sold", String(total.units)],
          ["Orders", String(total.orders)],
        ].map(([label, value]) => (
          <li key={label} className="flex flex-col gap-2 border border-line bg-ash-soft p-5">
            <span className="label text-xs text-smoke">{label}</span>
            <span className="font-mono text-3xl text-white">{value}</span>
          </li>
        ))}
      </ul>
      <p className="-mt-4 text-sm text-smoke">
        Paid orders only. Sales is the price of the items, before shipping.
      </p>

      <div className="grid gap-10 xl:grid-cols-2">
        <SalesTable
          title="By product type"
          help="Every item counts once, so this adds up to the total."
          rows={categories.filter((row) => row.kind === "PRODUCT_TYPE")}
        />
        <SalesTable
          title="By interest"
          help="A product in several interests counts in each, so this can add up to more than the total."
          rows={categories.filter((row) => row.kind === "INTEREST")}
        />
      </div>
    </div>
  );
}
