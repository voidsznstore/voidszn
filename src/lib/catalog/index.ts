import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getDb, hasDatabase } from "@/db";
import { fetchCatalog } from "@/db/queries/catalog";
import { ALL, BEST_SELLERS, JUST_IN, sampleCatalog } from "./sample";
import { CATALOG_TAG } from "./tag";
import type {
  Catalog,
  CatalogCategory,
  CatalogProduct,
  CategoryKind,
  Collection,
} from "./types";

export type * from "./types";

/**
 * The storefront catalog.
 *
 * It is read from the database and kept in the cache, so pages don't query the
 * database on every visit. Every admin change to a product or category clears
 * the cache (see `CATALOG_TAG` in ./tag), so edits show up straight away.
 *
 * Checkout does not use this. It reads prices directly from the database.
 */

export async function getCatalog(): Promise<Catalog> {
  "use cache";
  // Admin changes clear this straight away through the tag. The five minutes is a
  // backstop: if a page happened to be rebuilding at the very moment of a change,
  // it catches up by itself soon after.
  cacheLife({ stale: 300, revalidate: 300, expire: 86_400 });
  cacheTag(CATALOG_TAG);

  // No database yet (a fresh local checkout): show the sample products.
  if (!hasDatabase()) return sampleCatalog();
  return fetchCatalog(getDb());
}

export async function getProducts(): Promise<CatalogProduct[]> {
  return (await getCatalog()).products;
}

export async function getProductBySlug(slug: string): Promise<CatalogProduct | undefined> {
  return (await getCatalog()).products.find((product) => product.slug === slug);
}

/** Other products to show under a product: same type first, then the rest. */
export async function getRelatedProducts(slug: string, limit = 3): Promise<CatalogProduct[]> {
  const { products } = await getCatalog();
  const current = products.find((product) => product.slug === slug);
  const others = products.filter((product) => product.slug !== slug);
  return [
    ...others.filter((product) => product.typeSlug === current?.typeSlug),
    ...others.filter((product) => product.typeSlug !== current?.typeSlug),
  ].slice(0, limit);
}

export async function getCategories(kind?: CategoryKind): Promise<CatalogCategory[]> {
  const { categories } = await getCatalog();
  return kind ? categories.filter((category) => category.kind === kind) : categories;
}

export async function getCollections(): Promise<Collection[]> {
  return [ALL, BEST_SELLERS, JUST_IN, ...(await getCatalog()).categories];
}

export async function getCollection(slug: string): Promise<Collection | undefined> {
  return (await getCollections()).find((collection) => collection.slug === slug);
}

/** How many products the two automatic lists show. */
const LIST_LENGTH = 24;

export async function getCollectionProducts(slug: string): Promise<CatalogProduct[]> {
  const { products, bestSellers, categoryProducts } = await getCatalog();
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const pick = (slugs: string[]) =>
    slugs.map((item) => bySlug.get(item)).filter((product) => product !== undefined);
  const newestFirst = [...products].sort((a, b) => b.createdAt - a.createdAt);

  switch (slug) {
    case ALL.slug:
      return products;
    case BEST_SELLERS.slug: {
      // Ranked by what has actually sold. Until there are sales, newest fills the list.
      const ranked = pick(bestSellers);
      const rest = newestFirst.filter((product) => !bestSellers.includes(product.slug));
      return [...ranked, ...(ranked.length < 4 ? rest : [])].slice(0, LIST_LENGTH);
    }
    case JUST_IN.slug:
      return newestFirst.slice(0, LIST_LENGTH);
    default:
      return pick(categoryProducts[slug] ?? []);
  }
}
