"use client";

import { useMemo, useState } from "react";
import type { CatalogProduct } from "@/lib/catalog";
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
      return sorted.sort((a, b) => b.addedOrder - a.addedOrder);
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
      <p className="border border-line bg-ash-soft px-5 py-10 text-center text-bone-dim">
        Nothing here yet. New designs are on the way.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label text-xs text-smoke">
          {products.length} {products.length === 1 ? "product" : "products"}
        </p>
        <label className="flex items-center gap-3 text-sm">
          <span className="label text-xs text-smoke">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="min-h-11 border border-line-strong bg-void px-3 text-bone"
          >
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-4">
        {sorted.map((product) => (
          <ProductCard key={product.slug} product={product} />
        ))}
      </div>
    </div>
  );
}
