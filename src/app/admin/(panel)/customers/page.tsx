import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import {
  CUSTOMER_SORTS,
  CUSTOMER_VIEWS,
  type CustomerSort,
  type CustomerView,
  NEW_CUSTOMER_DAYS,
  countCustomerViews,
  listCustomers,
} from "@/db/queries/admin-customers";
import { formatDate } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Customers" };

type Props = PageProps<"/admin/customers">;

export default function CustomersPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Customers"
        action={
          <Link href="/admin/customers/new" className="btn btn-accent">
            Add customer
          </Link>
        }
      />
      <Suspense fallback={<Loading />}>
        <Customers searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Customers({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const view = ((one(params.view) ?? "all") in CUSTOMER_VIEWS ? one(params.view) : "all") as CustomerView;
  const sort = ((one(params.sort) ?? "newest") in CUSTOMER_SORTS ? one(params.sort) : "newest") as CustomerSort;
  const q = one(params.q)?.slice(0, 100) ?? "";

  const db = getDb();
  const [customers, counts] = await Promise.all([
    listCustomers(db, { view, q, sort }),
    countCustomerViews(db),
  ]);

  const tabHref = (target: CustomerView) => {
    const query = new URLSearchParams();
    if (target !== "all") query.set("view", target);
    if (q) query.set("q", q);
    if (sort !== "newest") query.set("sort", sort);
    const text = query.toString();
    return text ? `/admin/customers?${text}` : "/admin/customers";
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Customer groups" className="flex flex-wrap gap-2">
        {(Object.keys(CUSTOMER_VIEWS) as CustomerView[]).map((key) => (
          <Link
            key={key}
            href={tabHref(key)}
            aria-current={key === view ? "page" : undefined}
            className="chip"
          >
            {CUSTOMER_VIEWS[key]}
            <span className="font-mono text-xs">{counts[key]}</span>
          </Link>
        ))}
      </nav>
      <p className="-mt-3 text-[0.8125rem] text-smoke">
        New means added in the last {NEW_CUSTOMER_DAYS} days. Returning means two or more orders.
      </p>

      <form key={[view, q, sort].join("|")} className="flex flex-wrap items-end gap-3">
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="filter-q" className="label text-smoke">
            Search
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, email or phone"
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-sort" className="label text-smoke">
            Sort by
          </label>
          <select id="filter-sort" name="sort" defaultValue={sort} className="input w-auto min-w-40">
            {Object.entries(CUSTOMER_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-glass min-h-[2.875rem] px-5">
          Apply
        </button>
        {q ? (
          <Link
            href={view === "all" ? "/admin/customers" : `/admin/customers?view=${view}`}
            className="inline-flex min-h-[2.875rem] items-center text-sm link"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {customers.length === 0 ? (
        <p className="panel px-5 py-10 text-center text-bone-dim">
          {q || view !== "all"
            ? "No customers match."
            : "No customers yet. They appear here when someone orders, or when you add one."}
        </p>
      ) : (
        <div className="panel overflow-x-auto px-5 py-1">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-xs text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Customer</th>
                <th scope="col" className="py-3 pr-4 font-medium">Since</th>
                <th scope="col" className="py-3 pr-4 font-medium">Orders</th>
                <th scope="col" className="py-3 pr-4 font-medium">Spent</th>
                <th scope="col" className="py-3 pr-4 font-medium">Last order</th>
                <th scope="col" className="py-3 font-medium">Marketing emails</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-line hover:bg-white/[0.04]">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="inline-flex min-h-11 flex-col justify-center underline-offset-4 hover:underline"
                    >
                      <span className="font-semibold text-white">{customer.name ?? customer.email}</span>
                      {customer.name ? <span className="text-smoke">{customer.email}</span> : null}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-bone-dim">
                    {formatDate(customer.createdAt)}
                    {customer.isNew ? (
                      <span className="tag ml-2">New</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 font-mono">{customer.orders}</td>
                  <td className="py-2 pr-4 font-mono">{formatMoney(customer.spentCents)}</td>
                  <td className="py-2 pr-4 text-bone-dim">
                    {customer.lastOrderAt ? formatDate(new Date(customer.lastOrderAt)) : "None"}
                  </td>
                  <td className="py-2 text-bone-dim">
                    {customer.optedOut ? "Unsubscribed" : customer.acceptsEmail ? "Yes" : "No"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
