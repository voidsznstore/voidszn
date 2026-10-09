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

export function CollectionBrowser({ products }: { products: CatalogProduct[] }) {
  const [sort, setSort] = useState<Sort>("featured");
  const sorted = useMemo(() => sortProducts(products, sort), [products, sort]);

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

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="num text-sm text-smoke">
          {products.length} {products.length === 1 ? "product" : "products"}
        </p>
        <label className="flex items-center gap-3 text-sm text-smoke">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="input min-h-11 w-auto !rounded-full py-0 pl-4 text-sm"
          >
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-6 lg:grid-cols-4">
        {sorted.map((product) => (
          <ProductCard key={product.slug} product={product} />
        ))}
      </div>
    </div>
  );
}
