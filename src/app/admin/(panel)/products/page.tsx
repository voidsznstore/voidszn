import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import {
  PRODUCT_SORTS,
  type ProductSort,
  listCategories,
  listProducts,
} from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Products" };

type Props = PageProps<"/admin/products">;

export default function ProductsPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Products"
        action={
          <Link href="/admin/products/new" className="btn btn-accent">
            Add product
          </Link>
        }
      />
      <Suspense fallback={<Loading />}>
        <Products searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Products({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const q = one(params.q)?.slice(0, 100) ?? "";
  const category = UUID.test(one(params.category) ?? "") ? one(params.category) : undefined;
  const status = one(params.status) === "live" || one(params.status) === "draft"
    ? (one(params.status) as "live" | "draft")
    : undefined;
  const sort = (one(params.sort) ?? "newest") in PRODUCT_SORTS
    ? ((one(params.sort) ?? "newest") as ProductSort)
    : "newest";

  const db = getDb();
  const [categories, products] = await Promise.all([
    listCategories(db),
    listProducts(db, { q, category, status, sort }),
  ]);
  const isFiltered = Boolean(q || category || status);
  const selectClass = "input w-auto min-w-40";

  return (
    <div className="flex flex-col gap-6">
      {one(params.deleted) ? (
        <p className="panel px-4 py-3 text-sm">Product deleted.</p>
      ) : null}

      {/* A plain form: choosing filters and pressing Apply reloads the list. The key
          makes the boxes match the address again after Clear or the back button. */}
      <form
        key={[q, category, status, sort].join("|")}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="filter-q" className="label text-smoke">
            Search
          </label>
          <input id="filter-q" name="q" type="search" defaultValue={q} placeholder="Name" className="input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-category" className="label text-smoke">
            Category
          </label>
          <select id="filter-category" name="category" defaultValue={category ?? ""} className={selectClass}>
            <option value="">All categories</option>
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
          <label htmlFor="filter-status" className="label text-smoke">
            Status
          </label>
          <select id="filter-status" name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">Any status</option>
            <option value="live">On sale</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-sort" className="label text-smoke">
            Sort by
          </label>
          <select id="filter-sort" name="sort" defaultValue={sort} className={selectClass}>
            {Object.entries(PRODUCT_SORTS).map(([value, label]) => (
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
          <Link href="/admin/products" className="inline-flex min-h-[2.875rem] items-center text-sm link">
            Clear
          </Link>
        ) : null}
      </form>

      <p className="label text-smoke">
        {products.length} {products.length === 1 ? "product" : "products"}
      </p>

      {products.length === 0 ? (
        <p className="panel px-5 py-10 text-center text-bone-dim">
          {isFiltered ? "Nothing matches those filters." : "No products yet. Add your first one."}
        </p>
      ) : (
        <div className="panel overflow-x-auto px-5 py-1">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead>
              <tr className="label border-b border-line text-xs text-smoke">
                <th scope="col" className="py-3 pr-4 font-medium">Product</th>
                <th scope="col" className="py-3 pr-4 font-medium">Type</th>
                <th scope="col" className="py-3 pr-4 font-medium">Interests</th>
                <th scope="col" className="py-3 pr-4 font-medium">Price</th>
                <th scope="col" className="py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-line hover:bg-white/[0.04]">
                  <td className="py-2 pr-4">
                    <Link href={`/admin/products/${product.id}`} className="flex min-h-14 items-center gap-3">
                      <span
                        className="relative block h-12 w-10 flex-none well overflow-hidden !rounded-[0.5rem]"
                        style={product.thumbnail ? undefined : { background: product.swatch ?? undefined }}
                      >
                        {product.thumbnail ? (
                          <Image src={product.thumbnail} alt="" fill sizes="2.5rem" className="object-cover" />
                        ) : null}
                      </span>
                      <span className="font-semibold text-white underline-offset-4 hover:underline">
                        {product.name}
                      </span>
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{product.type ?? <span className="text-smoke">None</span>}</td>
                  <td className="py-2 pr-4 text-bone-dim">{product.interests.join(", ")}</td>
                  <td className="py-2 pr-4 font-mono">{formatMoney(product.priceCents)}</td>
                  <td className="py-2">
                    <span className={`label ${product.isActive ? "text-bone" : "text-smoke"}`}>
                      {product.isActive ? "On sale" : "Draft"}
                    </span>
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
