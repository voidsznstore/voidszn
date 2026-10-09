import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DiscountSwitch } from "@/components/admin/discount-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import {
  DISCOUNT_SORTS,
  DISCOUNT_STATE_LABELS,
  DISCOUNT_TYPES,
  DISCOUNT_VIEWS,
  type DiscountSort,
  type DiscountState,
  type DiscountTypeFilter,
  type DiscountView,
  countDiscountViews,
  discountState,
  listDiscounts,
} from "@/db/queries/admin-discounts";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { discountSummary } from "@/lib/discounts/describe";

export const metadata: Metadata = { title: "Discounts" };

type Props = PageProps<"/admin/discounts">;

export default function DiscountsPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Discounts"
        action={
          <Link href="/admin/discounts/new" className="btn btn-accent">
            Create code
          </Link>
        }
      />
      <Suspense fallback={<Loading />}>
        <Discounts searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const pick = <Options extends Record<string, string>>(
  options: Options,
  value: string | undefined,
  fallback: keyof Options,
) => (value !== undefined && value in options ? value : fallback) as keyof Options;

const STATE_TAGS: Record<DiscountState, string> = {
  active: "tag tag-good",
  scheduled: "tag tag-warn",
  expired: "tag tag-mute",
  used_up: "tag tag-mute",
  off: "tag tag-mute",
};

async function Discounts({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const view = pick(DISCOUNT_VIEWS, one(params.view), "all") as DiscountView;
  const type = pick(DISCOUNT_TYPES, one(params.type), "any") as DiscountTypeFilter;
  const sort = pick(DISCOUNT_SORTS, one(params.sort), "newest") as DiscountSort;
  const q = one(params.q)?.trim().slice(0, 40) ?? "";

  const db = getDb();
  const [discounts, counts] = await Promise.all([
    listDiscounts(db, { view, type, q, sort }),
    countDiscountViews(db),
  ]);
  const isFiltered = Boolean(q) || type !== "any";

  /** Address for a tab, keeping the other filters as they are. */
  const tabHref = (target: DiscountView) => {
    const query = new URLSearchParams();
    if (target !== "all") query.set("view", target);
    if (q) query.set("q", q);
    if (type !== "any") query.set("type", type);
    if (sort !== "newest") query.set("sort", sort);
    const text = query.toString();
    return text ? `/admin/discounts?${text}` : "/admin/discounts";
  };

  return (
    <div className="flex flex-col gap-6">
      {params.deleted ? (
        <p role="status" className="panel px-4 py-3 text-sm">
          Code deleted.
        </p>
      ) : null}

      <nav aria-label="Discount status" className="flex flex-wrap gap-2">
        {(Object.keys(DISCOUNT_VIEWS) as DiscountView[]).map((key) => (
          <Link key={key} href={tabHref(key)} aria-current={key === view ? "page" : undefined} className="chip">
            {DISCOUNT_VIEWS[key]}
            <span className="num text-xs opacity-70">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      <form key={[view, q, type, sort].join("|")} className="flex flex-wrap items-end gap-3">
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="filter-q" className="label text-smoke">
            Search
          </label>
          <input id="filter-q" name="q" type="search" defaultValue={q} placeholder="Code" className="input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-type" className="label text-smoke">
            Type
          </label>
          <select id="filter-type" name="type" defaultValue={type} className="input w-auto min-w-44">
            {Object.entries(DISCOUNT_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-sort" className="label text-smoke">
            Sort by
          </label>
          <select id="filter-sort" name="sort" defaultValue={sort} className="input w-auto min-w-44">
            {Object.entries(DISCOUNT_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-glass min-h-[2.875rem] px-5">
          Apply
        </button>
        {isFiltered ? (
          <Link
            href={view === "all" ? "/admin/discounts" : `/admin/discounts?view=${view}`}
            className="link inline-flex min-h-[2.875rem] items-center text-sm"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {discounts.length === 0 ? (
        <div className="panel flex flex-col items-center gap-4 px-5 py-12 text-center text-bone-dim">
          {isFiltered || view !== "all" ? (
            <p>No codes match.</p>
          ) : (
            <>
              <p className="max-w-md text-balance">
                No discount codes yet. Make one for a sale, a welcome offer or free shipping,
                then drop it into a campaign.
              </p>
              <Link href="/admin/discounts/new" className="btn btn-accent">
                Create code
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="panel overflow-x-auto px-5 py-1">
          <table className="w-full min-w-[50rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Code</th>
                <th scope="col" className="py-3 pr-4 font-medium">Gives</th>
                <th scope="col" className="py-3 pr-4 font-medium">Used</th>
                <th scope="col" className="py-3 pr-4 font-medium">Runs</th>
                <th scope="col" className="py-3 pr-4 font-medium">Status</th>
                <th scope="col" className="py-3 font-medium">On</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((discount) => {
                const state = discountState(discount);
                return (
                  <tr key={discount.id} className="border-b border-line hover:bg-white/[0.04]">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/discounts/${discount.id}`}
                        className="inline-flex min-h-11 flex-col justify-center underline-offset-4 hover:underline"
                      >
                        <span className="font-mono font-semibold tracking-wider text-white">{discount.code}</span>
                        {discount.note ? <span className="text-smoke">{discount.note}</span> : null}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="block">{discountSummary(discount)}</span>
                      {discount.firstOrderOnly ? (
                        <span className="block text-smoke">First order only</span>
                      ) : discount.perCustomerLimit ? (
                        <span className="block text-smoke">Once per customer</span>
                      ) : null}
                    </td>
                    <td className="num py-2 pr-4">
                      {discount.usedCount}
                      {discount.maxUses !== null ? <span className="text-smoke"> of {discount.maxUses}</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-bone-dim">
                      {discount.startsAt || discount.expiresAt ? (
                        <>
                          <span className="block">
                            {discount.startsAt ? `From ${formatDateTime(discount.startsAt)}` : "From the start"}
                          </span>
                          <span className="block">
                            {discount.expiresAt ? `Until ${formatDateTime(discount.expiresAt)}` : "No end date"}
                          </span>
                        </>
                      ) : (
                        "No end date"
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={STATE_TAGS[state]}>{DISCOUNT_STATE_LABELS[state]}</span>
                    </td>
                    <td className="py-2">
                      <DiscountSwitch id={discount.id} code={discount.code} isActive={discount.isActive} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
