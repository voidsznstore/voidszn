import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { graphicFor, inkFor } from "@/lib/catalog/shape";
import type {
  Catalog,
  CatalogCategory,
  CatalogImage,
  CatalogProduct,
} from "@/lib/catalog/types";
import type { Database } from "../index";
import {
  categories,
  orderItems,
  orders,
  productCategories,
  productColors,
  productImages,
  productVariants,
  products,
} from "../schema";

const BEST_SELLER_WINDOW_DAYS = 90;
const SAMPLE_PREFIX = "sample-";

const toImage = (row: {
  url: string;
  altText: string;
  width: number | null;
  height: number | null;
}): CatalogImage => ({ url: row.url, alt: row.altText, width: row.width, height: row.height });

/** Splits the one-per-line details field into a list. */
export const detailLines = (text: string | null): string[] =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Everything the storefront shows: active categories and active products with
 * their colors, sizes, photos and categories. Never selects cost fields.
 */
export async function fetchCatalog(db: Database): Promise<Catalog> {
  const [categoryRows, productRows] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name)),
    db
      .select()
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.sortOrder), desc(products.createdAt)),
  ]);

  const catalogCategories: CatalogCategory[] = categoryRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    description: row.description ?? "",
  }));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));

  const ids = productRows.map((row) => row.id);
  if (ids.length === 0) {
    return { categories: catalogCategories, products: [], bestSellers: [], categoryProducts: {} };
  }

  const since = new Date(Date.now() - BEST_SELLER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [colorRows, variantRows, imageRows, linkRows, salesRows] = await Promise.all([
    db
      .select()
      .from(productColors)
      .where(inArray(productColors.productId, ids))
      .orderBy(asc(productColors.sortOrder), asc(productColors.name)),
    db
      .select({
        productId: productVariants.productId,
        size: productVariants.size,
        priceCents: productVariants.priceCents,
        sortOrder: productVariants.sortOrder,
      })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.sortOrder)),
    db
      .select()
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
    db
      .select()
      .from(productCategories)
      .where(inArray(productCategories.productId, ids))
      .orderBy(asc(productCategories.sortOrder)),
    db
      .select({
        productId: orderItems.productId,
        sold: sql<number>`sum(${orderItems.quantity})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(
          isNotNull(orderItems.productId),
          inArray(orders.status, ["PAID", "IN_PRODUCTION", "SHIPPED", "DELIVERED"]),
          gte(orders.createdAt, since),
        ),
      )
      .groupBy(orderItems.productId)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(48),
  ]);

  const catalogProducts: CatalogProduct[] = [];
  for (const row of productRows) {
    const colors = colorRows.filter((color) => color.productId === row.id);
    const images = imageRows.filter((image) => image.productId === row.id);

    // One entry per size. Every color of a size is sold at the same price.
    const sizes = new Map<string, number>();
    for (const variant of variantRows) {
      if (variant.productId !== row.id) continue;
      const known = sizes.get(variant.size);
      sizes.set(variant.size, known === undefined ? variant.priceCents : Math.min(known, variant.priceCents));
    }
    // Nothing to sell without at least one color and one size.
    if (colors.length === 0 || sizes.size === 0) continue;

    const productCategorySlugs = linkRows
      .filter((link) => link.productId === row.id)
      .map((link) => categoryById.get(link.categoryId))
      .filter((category) => category !== undefined);
    const type = productCategorySlugs.find((category) => category.kind === "PRODUCT_TYPE");

    catalogProducts.push({
      slug: row.slug,
      name: row.name,
      categories: productCategorySlugs.map((category) => category.slug),
      typeSlug: type?.slug ?? null,
      typeName: type?.name ?? null,
      priceCents: Math.min(...sizes.values()),
      compareAtPriceCents: row.compareAtPriceCents,
      shortDescription: row.shortDescription ?? "",
      description: row.description ?? "",
      details: detailLines(row.detailsText),
      fit: row.fitText ?? "",
      colors: colors.map((color) => ({
        name: color.name,
        hex: color.hex,
        ink: inkFor(color.hex),
        images: images.filter((image) => image.colorId === color.id).map(toImage),
      })),
      sizes: [...sizes].map(([size, priceCents]) => ({ size, priceCents })),
      images: images.filter((image) => image.colorId === null).map(toImage),
      graphic: graphicFor(row.slug),
      createdAt: row.createdAt.getTime(),
      isSample: row.slug.startsWith(SAMPLE_PREFIX),
    });
  }

  const slugById = new Map(productRows.map((row) => [row.id, row.slug]));
  const onSale = new Set(catalogProducts.map((product) => product.slug));
  const categoryProducts: Record<string, string[]> = {};
  for (const link of linkRows) {
    const category = categoryById.get(link.categoryId);
    const slug = slugById.get(link.productId);
    if (!category || !slug || !onSale.has(slug)) continue;
    (categoryProducts[category.slug] ??= []).push(slug);
  }

  return {
    categories: catalogCategories,
    products: catalogProducts,
    bestSellers: salesRows
      .map((row) => (row.productId ? slugById.get(row.productId) : undefined))
      .filter((slug): slug is string => slug !== undefined && onSale.has(slug)),
    categoryProducts,
  };
}

/** One thing that can be bought right now, with the price that will be charged. */
export type Sellable = {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  color: string;
  size: string;
  sku: string;
  priceCents: number;
  /** Product type slug, e.g. "t-shirts". Drives the shipping rate. */
  typeSlug: string | null;
  imageUrl: string | null;
};

/**
 * Looks up what is on sale for the given products, straight from the database.
 * Checkout uses this instead of the cached catalog so a price is never stale.
 */
export async function findSellables(db: Database, slugs: string[]): Promise<Sellable[]> {
  if (slugs.length === 0) return [];

  const rows = await db
    .select({
      productId: products.id,
      slug: products.slug,
      name: products.name,
      colorId: productColors.id,
      color: productColors.name,
      variantId: productVariants.id,
      size: productVariants.size,
      sku: productVariants.sku,
      priceCents: productVariants.priceCents,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(productColors, eq(productColors.id, productVariants.colorId))
    .where(
      and(
        inArray(products.slug, slugs),
        eq(products.isActive, true),
        eq(productVariants.isActive, true),
      ),
    );
  if (rows.length === 0) return [];

  const productIds = [...new Set(rows.map((row) => row.productId))];
  const [types, images] = await Promise.all([
    db
      .select({ productId: productCategories.productId, slug: categories.slug })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(
        and(
          inArray(productCategories.productId, productIds),
          eq(categories.kind, "PRODUCT_TYPE"),
        ),
      ),
    db
      .select({
        productId: productImages.productId,
        colorId: productImages.colorId,
        url: productImages.url,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
  ]);

  return rows.map((row) => {
    const ofProduct = images.filter((image) => image.productId === row.productId);
    const image =
      ofProduct.find((candidate) => candidate.colorId === row.colorId) ??
      ofProduct.find((candidate) => candidate.colorId === null);
    return {
      productId: row.productId,
      variantId: row.variantId,
      slug: row.slug,
      name: row.name,
      color: row.color,
      size: row.size,
      sku: row.sku,
      priceCents: row.priceCents,
      typeSlug: types.find((type) => type.productId === row.productId)?.slug ?? null,
      imageUrl: image?.url ?? null,
    };
  });
}
