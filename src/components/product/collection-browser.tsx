"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogProduct } from "@/lib/catalog/types";
import { ProductCard } from "./product-card";

const SORTS = {
  featured: "Featured",
  newest: "Newest",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
} as const;

type Sort = keyof typeof SORTS;
type Option = { slug: string; name: string };

/** How many products show before "Show more". */
const PAGE = 24;

function sortProducts(products: CatalogProduct[], sort: Sort): CatalogProduct[] {
  const sorted = [...products];
  switch (sort) {
    case "newest":
      return sorted.sort((a, b) => b.createdAt - a.createdAt);
    case "price-asc":
      return sorted.sort((a, b) => a.priceCents - b.priceCents);
    case "price-desc":
      return sorted.sort((a, b) => b.priceCents - a.priceCents);
    case "featured":
      // The order the page was given: a category's own order, or the list's ranking.
      return sorted;
  }
}

type Props = {
  products: CatalogProduct[];
  /**
   * Adds the filters across the top: interests as a row of pills, product types
   * as a menu. Only choices that have something in them are offered.
   */
  filters?: { interests: Option[]; types: Option[] };
  /** Load the first row of pictures straight away. For a grid that opens the page. */
  eager?: boolean;
};

export function CollectionBrowser({ products, filters, eager = false }: Props) {
  const [sort, setSort] = useState<Sort>("featured");
  const [interest, setInterest] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const interests = (filters?.interests ?? []).filter((option) =>
    products.some((product) => product.categories.includes(option.slug)),
  );
  const types = (filters?.types ?? []).filter((option) =>
    products.some((product) => product.typeSlug === option.slug),
  );

  const visible = useMemo(() => {
    const matching = products.filter(
      (product) =>
        (interest === null || product.categories.includes(interest)) &&
        (type === null || product.typeSlug === type),
    );
    return sortProducts(matching, sort);
  }, [products, sort, interest, type]);

  if (products.length === 0) {
    return (
      <div className="panel mx-auto flex max-w-xl flex-col items-center gap-5 px-6 py-14 text-center">
        <p className="text-bone-dim">Nothing here yet. New designs are on the way.</p>
        <Link href="/collections/all" className="btn btn-glass">
          Shop all
        </Link>
      </div>
    );
  }

  const pick = (apply: () => void) => {
    apply();
    setShown(PAGE);
  };
  const select = "input min-h-11 w-auto !rounded-full py-0 pl-4 text-sm";

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {interests.length > 1 ? (
          <div
            role="group"
            aria-label="Filter by interest"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          >
            <button
              type="button"
              aria-pressed={interest === null}
              onClick={() => pick(() => setInterest(null))}
              className="chip flex-none"
            >
              All
            </button>
            {interests.map((option) => (
              <button
                key={option.slug}
                type="button"
                aria-pressed={interest === option.slug}
                onClick={() => pick(() => setInterest(option.slug))}
                className="chip flex-none"
              >
                {option.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="num text-sm text-smoke">
            {visible.length} {visible.length === 1 ? "product" : "products"}
          </p>
        )}

        <div className="flex flex-none flex-wrap items-center gap-2">
          {types.length > 1 ? (
            <label className="flex items-center">
              <span className="sr-only">Category</span>
              <select
                value={type ?? ""}
                onChange={(event) => pick(() => setType(event.target.value || null))}
                className={select}
              >
                <option value="">All categories</option>
                {types.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center">
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className={select}>
              {Object.entries(SORTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {value === "featured" ? "Sort: featured" : label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panel mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-6 py-14 text-center">
          <p aria-live="polite" className="text-bone-dim">
            Nothing matches both of those yet.
          </p>
          <button
            type="button"
            onClick={() =>
              pick(() => {
                setInterest(null);
                setType(null);
              })
            }
            className="btn btn-glass"
          >
            Show everything
          </button>
        </div>
      ) : (
        <>
          <p aria-live="polite" className="sr-only">
            Showing {Math.min(shown, visible.length)} of {visible.length} products
          </p>
          <h2 className="sr-only">Products</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {visible.slice(0, shown).map((product, index) => (
              <ProductCard key={product.slug} product={product} priority={eager && index < 4} />
            ))}
          </div>
          {visible.length > shown ? (
            <div className="flex justify-center pt-2">
              <button type="button" onClick={() => setShown((count) => count + PAGE)} className="btn btn-glass">
                Show more
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
