import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { listCategories } from "@/db/queries/admin-catalog";
import {
  ORDER_SORTS,
  ORDER_VIEWS,
  type OrderSort,
  type OrderView,
  countOrderViews,
  listOrders,
} from "@/db/queries/admin-orders";
import { formatDateTime, statusLabel } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Orders" };

type Props = PageProps<"/admin/orders">;

export default function OrdersPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader title="Orders" />
      <Suspense fallback={<Loading />}>
        <Orders searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Orders({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const view = ((one(params.view) ?? "all") in ORDER_VIEWS ? one(params.view) : "all") as
    | OrderView
    | undefined;
  const currentView: OrderView = view ?? "all";
  const q = one(params.q)?.slice(0, 100) ?? "";
  const category = UUID.test(one(params.category) ?? "") ? one(params.category) : undefined;
  const sort = ((one(params.sort) ?? "newest") in ORDER_SORTS ? one(params.sort) : "newest") as OrderSort;

  const db = getDb();
  const [orders, counts, categories] = await Promise.all([
    listOrders(db, { view: currentView, q, category, sort }),
    countOrderViews(db),
    listCategories(db),
  ]);
  const isFiltered = Boolean(q || category);

  /** Address for a tab, keeping the other filters as they are. */
  const tabHref = (target: OrderView) => {
    const query = new URLSearchParams();
    if (target !== "all") query.set("view", target);
    if (q) query.set("q", q);
    if (category) query.set("category", category);
    if (sort !== "newest") query.set("sort", sort);
    const text = query.toString();
    return text ? `/admin/orders?${text}` : "/admin/orders";
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Order status" className="flex flex-wrap gap-2">
        {(Object.keys(ORDER_VIEWS) as OrderView[]).map((key) => (
          <Link
            key={key}
            href={tabHref(key)}
            aria-current={key === currentView ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 border px-4 text-sm font-semibold ${
              key === currentView
                ? "border-bone bg-bone text-void"
                : "border-line-strong hover:border-bone"
            }`}
          >
            {ORDER_VIEWS[key]}
            <span className="font-mono text-xs">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      <form key={[currentView, q, category, sort].join("|")} className="flex flex-wrap items-end gap-3">
        {currentView !== "all" ? <input type="hidden" name="view" value={currentView} /> : null}
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="filter-q" className="label text-xs text-smoke">
            Search
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Order number, name or email"
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-category" className="label text-xs text-smoke">
            Contains a product from
          </label>
          <select id="filter-category" name="category" defaultValue={category ?? ""} className="input w-auto min-w-40">
            <option value="">Any category</option>
            <optgroup label="Product types">
              {categories
                .filter((item) => item.kind === "PRODUCT_TYPE")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Interests">
              {categories
                .filter((item) => item.kind === "INTEREST")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-sort" className="label text-xs text-smoke">
            Sort by
          </label>
          <select id="filter-sort" name="sort" defaultValue={sort} className="input w-auto min-w-40">
            {Object.entries(ORDER_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-outline min-h-[2.875rem] px-5">
          Apply
        </button>
        {isFiltered ? (
          <Link
            href={currentView === "all" ? "/admin/orders" : `/admin/orders?view=${currentView}`}
            className="inline-flex min-h-[2.875rem] items-center text-sm underline underline-offset-4"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {orders.length === 0 ? (
        <p className="border border-line bg-ash-soft px-5 py-10 text-center text-bone-dim">
          {isFiltered || currentView !== "all" ? "No orders match." : "No orders yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-xs text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Order</th>
                <th scope="col" className="py-3 pr-4 font-medium">Placed</th>
                <th scope="col" className="py-3 pr-4 font-medium">Customer</th>
                <th scope="col" className="py-3 pr-4 font-medium">Items</th>
                <th scope="col" className="py-3 pr-4 font-medium">Total</th>
                <th scope="col" className="py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderNumber} className="border-b border-line hover:bg-ash-soft">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="inline-flex min-h-11 items-center font-mono font-semibold text-white underline-offset-4 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-bone-dim">{formatDateTime(order.createdAt)}</td>
                  <td className="py-2 pr-4">
                    <span className="block">{order.shippingName}</span>
                    <span className="block text-smoke">{order.email}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono">{order.units}</td>
                  <td className="py-2 pr-4 font-mono">{formatMoney(order.totalCents)}</td>
                  <td className="py-2">
                    <span className="label text-xs">{statusLabel(order.status)}</span>
                    {order.flagged ? (
                      <span className="label ml-2 bg-accent px-2 py-1 text-[0.6875rem] text-on-accent">
                        Needs attention
                      </span>
                    ) : null}
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
