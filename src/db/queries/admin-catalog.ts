import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  categories,
  productCategories,
  productColors,
  productImages,
  productVariants,
  products,
} from "../schema";

export type CategoryKind = "PRODUCT_TYPE" | "INTEREST";

/** Lowercase words joined by dashes, safe to use in a web address. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const skuFor = (slug: string, color: string, size: string) =>
  `${slug}-${color}-${size}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-");

/** A problem the person filling in the form can fix. Shown to them as written. */
export class FormError extends Error {}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export type AdminCategory = {
  id: string;
  kind: CategoryKind;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  productCount: number;
};

export async function listCategories(db: Database): Promise<AdminCategory[]> {
  const rows = await db
    .select({
      id: categories.id,
      kind: categories.kind,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      isActive: categories.isActive,
      productCount: count(productCategories.productId),
    })
    .from(categories)
    .leftJoin(productCategories, eq(productCategories.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name));
  return rows.map((row) => ({ ...row, description: row.description ?? "" }));
}

async function freeCategorySlug(db: Database, wanted: string, exceptId?: string): Promise<string> {
  const base = wanted || "category";
  for (let attempt = 1; attempt < 50; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    const [taken] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, slug), exceptId ? ne(categories.id, exceptId) : undefined))
      .limit(1);
    if (!taken) return slug;
  }
  throw new FormError("Could not find a free web address for that name.");
}

/** Addresses the storefront uses for its automatic lists. A category can't take one. */
const RESERVED_SLUGS = new Set(["all", "best-sellers", "just-in"]);

export async function createCategory(
  db: Database,
  input: { kind: CategoryKind; name: string; description: string },
): Promise<string> {
  const wanted = slugify(input.name);
  if (RESERVED_SLUGS.has(wanted)) throw new FormError("That name is used by a built-in list.");
  const slug = await freeCategorySlug(db, wanted);
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), -1) + 1` })
    .from(categories)
    .where(eq(categories.kind, input.kind));
  const [row] = await db
    .insert(categories)
    .values({
      kind: input.kind,
      name: input.name,
      slug,
      description: input.description || null,
      sortOrder: next,
    })
    .returning({ id: categories.id });
  return row.id;
}

export async function updateCategory(
  db: Database,
  id: string,
  input: { name: string; description: string; isActive: boolean },
): Promise<void> {
  await db
    .update(categories)
    .set({ name: input.name, description: input.description || null, isActive: input.isActive })
    .where(eq(categories.id, id));
}

/** Deletes a category. Its products stay; they just stop being listed under it. */
export async function deleteCategory(db: Database, id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

/** Saves a new order for one kind of category. `ids` is every category of that kind, first to last. */
export async function reorderCategories(
  db: Database,
  kind: CategoryKind,
  ids: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(categories)
        .set({ sortOrder: index })
        .where(and(eq(categories.id, id), eq(categories.kind, kind)));
    }
  });
}

export type CategoryDetail = AdminCategory & {
  products: { id: string; name: string; isActive: boolean }[];
};

export async function getCategory(db: Database, id: string): Promise<CategoryDetail | null> {
  const [category] = (await listCategories(db)).filter((row) => row.id === id);
  if (!category) return null;
  const rows = await db
    .select({ id: products.id, name: products.name, isActive: products.isActive })
    .from(productCategories)
    .innerJoin(products, eq(products.id, productCategories.productId))
    .where(eq(productCategories.categoryId, id))
    .orderBy(asc(productCategories.sortOrder), asc(products.name));
  return { ...category, products: rows };
}

/** Saves the order products appear in on one category's page. */
export async function reorderCategoryProducts(
  db: Database,
  categoryId: string,
  productIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, productId] of productIds.entries()) {
      await tx
        .update(productCategories)
        .set({ sortOrder: index })
        .where(
          and(
            eq(productCategories.categoryId, categoryId),
            eq(productCategories.productId, productId),
          ),
        );
    }
  });
}

/* ------------------------------------------------------------------ */
/* Product list                                                        */
/* ------------------------------------------------------------------ */

export const PRODUCT_SORTS = {
  newest: "Newest",
  name: "Name",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  category: "Category",
  updated: "Last edited",
} as const;
export type ProductSort = keyof typeof PRODUCT_SORTS;

export type ProductFilters = {
  q?: string;
  /** Category id. Matches products in that category, whichever kind it is. */
  category?: string;
  status?: "live" | "draft";
  sort?: ProductSort;
};

export type AdminProductRow = {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  isActive: boolean;
  updatedAt: Date;
  thumbnail: string | null;
  swatch: string | null;
  type: string | null;
  interests: string[];
};

export async function listProducts(
  db: Database,
  filters: ProductFilters,
): Promise<AdminProductRow[]> {
  const q = filters.q?.trim();
  // Escape the characters LIKE treats as wildcards.
  const pattern = q ? `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      priceCents: products.priceCents,
      isActive: products.isActive,
      updatedAt: products.updatedAt,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(
      and(
        pattern ? or(ilike(products.name, pattern), ilike(products.slug, pattern)) : undefined,
        filters.status ? eq(products.isActive, filters.status === "live") : undefined,
        filters.category
          ? inArray(
              products.id,
              db
                .select({ id: productCategories.productId })
                .from(productCategories)
                .where(eq(productCategories.categoryId, filters.category)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(products.createdAt))
    .limit(500);
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [links, images, colors] = await Promise.all([
    db
      .select({
        productId: productCategories.productId,
        kind: categories.kind,
        name: categories.name,
        sortOrder: categories.sortOrder,
      })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(inArray(productCategories.productId, ids))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
    db
      .select({ productId: productColors.productId, hex: productColors.hex })
      .from(productColors)
      .where(inArray(productColors.productId, ids))
      .orderBy(asc(productColors.sortOrder)),
  ]);

  const result: AdminProductRow[] = rows.map((row) => {
    const own = links.filter((link) => link.productId === row.id);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      priceCents: row.priceCents,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
      thumbnail: images.find((image) => image.productId === row.id)?.url ?? null,
      swatch: colors.find((color) => color.productId === row.id)?.hex ?? null,
      type: own.find((link) => link.kind === "PRODUCT_TYPE")?.name ?? null,
      interests: own.filter((link) => link.kind === "INTEREST").map((link) => link.name),
    };
  });

  const byName = (a: AdminProductRow, b: AdminProductRow) => a.name.localeCompare(b.name);
  switch (filters.sort) {
    case "name":
      return result.sort(byName);
    case "price-asc":
      return result.sort((a, b) => a.priceCents - b.priceCents || byName(a, b));
    case "price-desc":
      return result.sort((a, b) => b.priceCents - a.priceCents || byName(a, b));
    case "category":
      // By product type, then by first interest, then by name. Uncategorised last.
      return result.sort(
        (a, b) =>
          (a.type ?? "￿").localeCompare(b.type ?? "￿") ||
          (a.interests[0] ?? "￿").localeCompare(b.interests[0] ?? "￿") ||
          byName(a, b),
      );
    case "updated":
      return result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    default:
      return result;
  }
}

/* ------------------------------------------------------------------ */
/* One product                                                         */
/* ------------------------------------------------------------------ */

export type ProductDraft = {
  id?: string;
  name: string;
  slug: string;
  isActive: boolean;
  priceCents: number;
  compareAtPriceCents: number | null;
  shortDescription: string;
  description: string;
  detailsText: string;
  fitText: string;
  typeId: string | null;
  interestIds: string[];
  colors: { id?: string; name: string; hex: string }[];
  /** `priceCents` null means "same as the product price". */
  sizes: { size: string; priceCents: number | null }[];
  /** `color` is an index into `colors`, or null when the photo is for every color. */
  images: {
    id?: string;
    url: string;
    alt: string;
    width: number | null;
    height: number | null;
    color: number | null;
  }[];
};

export async function getProductDraft(db: Database, id: string): Promise<ProductDraft | null> {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) return null;

  const [colors, variants, images, links] = await Promise.all([
    db
      .select()
      .from(productColors)
      .where(eq(productColors.productId, id))
      .orderBy(asc(productColors.sortOrder), asc(productColors.name)),
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.sortOrder)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(eq(productCategories.productId, id)),
  ]);

  const sizes = new Map<string, number>();
  for (const variant of variants) {
    if (!sizes.has(variant.size)) sizes.set(variant.size, variant.priceCents);
  }

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    isActive: product.isActive,
    priceCents: product.priceCents,
    compareAtPriceCents: product.compareAtPriceCents,
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    detailsText: product.detailsText ?? "",
    fitText: product.fitText ?? "",
    typeId: links.find((link) => link.kind === "PRODUCT_TYPE")?.id ?? null,
    interestIds: links.filter((link) => link.kind === "INTEREST").map((link) => link.id),
    colors: colors.map((color) => ({ id: color.id, name: color.name, hex: color.hex })),
    sizes: [...sizes].map(([size, priceCents]) => ({
      size,
      priceCents: priceCents === product.priceCents ? null : priceCents,
    })),
    images: images.map((image) => {
      const index = colors.findIndex((color) => color.id === image.colorId);
      return {
        id: image.id,
        url: image.url,
        alt: image.altText,
        width: image.width,
        height: image.height,
        color: index === -1 ? null : index,
      };
    }),
  };
}

/**
 * Creates or updates a product with its colors, sizes, categories and photos, in
 * one transaction. Returns the product id and the addresses of any photos that
 * were removed, so the caller can delete the files.
 */
export async function saveProduct(
  db: Database,
  draft: ProductDraft,
): Promise<{ id: string; removedImageUrls: string[] }> {
  return db.transaction(async (tx) => {
    const [slugOwner] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, draft.slug), draft.id ? ne(products.id, draft.id) : undefined))
      .limit(1);
    if (slugOwner) throw new FormError("Another product already uses that web address.");

    const sizePrices = draft.sizes.map((size) => size.priceCents ?? draft.priceCents);
    const fields = {
      name: draft.name,
      slug: draft.slug,
      isActive: draft.isActive,
      // Cards show the lowest price a size is sold at.
      priceCents: Math.min(draft.priceCents, ...sizePrices),
      compareAtPriceCents: draft.compareAtPriceCents,
      shortDescription: draft.shortDescription || null,
      description: draft.description || null,
      detailsText: draft.detailsText || null,
      fitText: draft.fitText || null,
    };

    let productId = draft.id;
    if (productId) {
      const updated = await tx
        .update(products)
        .set(fields)
        .where(eq(products.id, productId))
        .returning({ id: products.id });
      if (updated.length === 0) throw new FormError("That product no longer exists.");
    } else {
      [{ id: productId }] = await tx.insert(products).values(fields).returning({ id: products.id });
    }

    /* Colors. Renames go through a throwaway name first so two colors can swap names. */
    const keptColorIds = draft.colors.flatMap((color) => (color.id ? [color.id] : []));
    await tx
      .delete(productColors)
      .where(
        and(
          eq(productColors.productId, productId),
          keptColorIds.length > 0 ? notInArray(productColors.id, keptColorIds) : undefined,
        ),
      );
    if (keptColorIds.length > 0) {
      await tx
        .update(productColors)
        .set({ name: sql`'~' || ${productColors.id}::text` })
        .where(and(eq(productColors.productId, productId), inArray(productColors.id, keptColorIds)));
    }
    const colorIds: string[] = [];
    for (const [index, color] of draft.colors.entries()) {
      if (color.id) {
        const updated = await tx
          .update(productColors)
          .set({ name: color.name, hex: color.hex, sortOrder: index })
          .where(and(eq(productColors.id, color.id), eq(productColors.productId, productId)))
          .returning({ id: productColors.id });
        if (updated.length === 0) throw new FormError("A color on this product no longer exists.");
        colorIds.push(color.id);
      } else {
        const [created] = await tx
          .insert(productColors)
          .values({ productId, name: color.name, hex: color.hex, sortOrder: index })
          .returning({ id: productColors.id });
        colorIds.push(created.id);
      }
    }

    /* Variants: one per color and size. Existing ones keep their id, so past orders still link. */
    const existing = await tx
      .select({
        id: productVariants.id,
        colorId: productVariants.colorId,
        size: productVariants.size,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    const wanted = colorIds.flatMap((colorId, colorIndex) =>
      draft.sizes.map((size, sizeIndex) => ({
        colorId,
        size: size.size,
        sku: skuFor(draft.slug, draft.colors[colorIndex].name, size.size),
        priceCents: sizePrices[sizeIndex],
        sortOrder: sizeIndex,
      })),
    );
    const keep = new Set<string>();
    // Free up every SKU first, so a renamed color or address can't collide with itself.
    if (existing.length > 0) {
      await tx
        .update(productVariants)
        .set({ sku: sql`'~' || ${productVariants.id}::text` })
        .where(eq(productVariants.productId, productId));
    }
    for (const variant of wanted) {
      const [skuOwner] = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, variant.sku))
        .limit(1);
      if (skuOwner) {
        throw new FormError(
          "Two colors or sizes are too alike to tell apart. Give each a distinct name.",
        );
      }
      const match = existing.find(
        (row) => row.colorId === variant.colorId && row.size === variant.size,
      );
      if (match) {
        await tx
          .update(productVariants)
          .set({ ...variant, isActive: true })
          .where(eq(productVariants.id, match.id));
        keep.add(match.id);
      } else {
        const [created] = await tx
          .insert(productVariants)
          .values({ productId, ...variant })
          .returning({ id: productVariants.id });
        keep.add(created.id);
      }
    }
    const dropped = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (dropped.length > 0) {
      await tx.delete(productVariants).where(inArray(productVariants.id, dropped));
    }

    /* Categories. Ones the product is already in keep their position on that category's page. */
    const categoryIds = [...new Set([...(draft.typeId ? [draft.typeId] : []), ...draft.interestIds])];
    await tx
      .delete(productCategories)
      .where(
        and(
          eq(productCategories.productId, productId),
          categoryIds.length > 0
            ? notInArray(productCategories.categoryId, categoryIds)
            : undefined,
        ),
      );
    if (categoryIds.length > 0) {
      const found = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, categoryIds));
      if (found.length !== categoryIds.length) {
        throw new FormError("A category on this product no longer exists.");
      }
      await tx
        .insert(productCategories)
        .values(categoryIds.map((categoryId) => ({ productId, categoryId })))
        .onConflictDoNothing();
    }

    /* Photos. */
    const before = await tx
      .select({ id: productImages.id, url: productImages.url })
      .from(productImages)
      .where(eq(productImages.productId, productId));
    const keptImageIds = new Set(draft.images.flatMap((image) => (image.id ? [image.id] : [])));
    const removed = before.filter((image) => !keptImageIds.has(image.id));
    if (removed.length > 0) {
      await tx.delete(productImages).where(
        inArray(
          productImages.id,
          removed.map((image) => image.id),
        ),
      );
    }
    for (const [index, image] of draft.images.entries()) {
      const values = {
        colorId: image.color === null ? null : (colorIds[image.color] ?? null),
        altText: image.alt,
        width: image.width,
        height: image.height,
        isPrimary: index === 0,
        sortOrder: index,
      };
      if (image.id) {
        await tx
          .update(productImages)
          .set(values)
          .where(and(eq(productImages.id, image.id), eq(productImages.productId, productId)));
      } else {
        await tx.insert(productImages).values({ productId, url: image.url, ...values });
      }
    }

    return { id: productId, removedImageUrls: removed.map((image) => image.url) };
  });
}

/** Deletes a product and everything under it. Returns its photo addresses for cleanup. */
export async function deleteProduct(db: Database, id: string): Promise<string[]> {
  const images = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(eq(productImages.productId, id));
  await db.delete(products).where(eq(products.id, id));
  return images.map((image) => image.url);
}
