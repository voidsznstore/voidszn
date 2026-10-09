/**
 * Shapes the storefront works with. Safe to import anywhere, including the browser.
 */

/** Stand-in artwork drawn on the placeholder tee when a product has no photo yet. */
export type Graphic = "rings" | "grid" | "bars" | "arc";

export type CategoryKind = "PRODUCT_TYPE" | "INTEREST";

export type CatalogCategory = {
  slug: string;
  name: string;
  kind: CategoryKind;
  description: string;
};

export type CatalogImage = {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type CatalogColor = {
  name: string;
  /** Garment color. */
  hex: string;
  /** A color that reads on top of the garment color. Used by the placeholder art. */
  ink: string;
  /** Photos of this color. Empty until photos are uploaded. */
  images: CatalogImage[];
};

export type CatalogSize = {
  size: string;
  priceCents: number;
};

export type CatalogProduct = {
  slug: string;
  name: string;
  /** Slugs of every category the product is in. */
  categories: string[];
  /** The one product type it belongs to, e.g. "t-shirts" / "T-Shirts". */
  typeSlug: string | null;
  typeName: string | null;
  /** Lowest price across sizes. What cards show. */
  priceCents: number;
  compareAtPriceCents: number | null;
  shortDescription: string;
  description: string;
  details: string[];
  fit: string;
  colors: CatalogColor[];
  sizes: CatalogSize[];
  /** Photos that aren't tied to one color. */
  images: CatalogImage[];
  graphic: Graphic;
  /** When it was added, in milliseconds. Newer is larger. */
  createdAt: number;
  isSample: boolean;
};

/** A page of products: either a category or one of the automatic lists. */
export type Collection = {
  slug: string;
  name: string;
  description: string;
};

export type Catalog = {
  categories: CatalogCategory[];
  /** Everything on sale, in the store's default order. */
  products: CatalogProduct[];
  /** Product slugs, best seller first. */
  bestSellers: string[];
  /** For each category slug, its product slugs in that category's own order. */
  categoryProducts: Record<string, string[]>;
};
