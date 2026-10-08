/**
 * Storefront catalog.
 *
 * SAMPLE DATA. These products exist so the homepage, category pages and product
 * page can be seen with something in them. They are replaced by database queries
 * (and real photos) once the store is connected to its database. Nothing here is
 * a real listing.
 *
 * Categories mirror the database: every category has a kind, and a product can
 * sit in any number of them (one product type, several interests).
 */

export type Graphic = "rings" | "grid" | "bars" | "arc";

export type CatalogColor = {
  name: string;
  /** Garment color. */
  hex: string;
  /** Print color on that garment. */
  ink: string;
};

export type CategoryKind = "PRODUCT_TYPE" | "INTEREST";

export type CatalogCategory = {
  slug: string;
  name: string;
  kind: CategoryKind;
  description: string;
};

export type CatalogProduct = {
  slug: string;
  name: string;
  /** Category slugs. The first PRODUCT_TYPE one is used for the breadcrumb. */
  categories: string[];
  priceCents: number;
  shortDescription: string;
  description: string;
  details: string[];
  fit: string;
  colors: CatalogColor[];
  sizes: string[];
  graphic: Graphic;
  /** Higher is newer. Becomes the created date once products live in the database. */
  addedOrder: number;
  /** Lower sells more. Null when not a best seller. Comes from real orders later. */
  bestSellerRank: number | null;
  isSample: boolean;
};

/** A page of products: either a category or one of the two automatic lists. */
export type Collection = {
  slug: string;
  name: string;
  description: string;
};

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const categories: CatalogCategory[] = [
  { slug: "t-shirts", name: "T-Shirts", kind: "PRODUCT_TYPE", description: "Printed tees." },
  { slug: "hoodies", name: "Hoodies", kind: "PRODUCT_TYPE", description: "Pullover hoodies." },
  {
    slug: "crewnecks",
    name: "Crewnecks",
    kind: "PRODUCT_TYPE",
    description: "Crewneck sweatshirts.",
  },
  { slug: "hats", name: "Hats", kind: "PRODUCT_TYPE", description: "Caps and hats." },

  { slug: "anime", name: "Anime", kind: "INTEREST", description: "Designs for anime fans." },
  { slug: "gaming", name: "Gaming", kind: "INTEREST", description: "Designs for people who play." },
  {
    slug: "film-and-tv",
    name: "Film & TV",
    kind: "INTEREST",
    description: "Designs for people who watch too much.",
  },
  { slug: "music", name: "Music", kind: "INTEREST", description: "Designs for the loud ones." },
  {
    slug: "halloween",
    name: "Halloween",
    kind: "INTEREST",
    description: "Spooky season, all year.",
  },
  {
    slug: "everything-else",
    name: "Everything Else",
    kind: "INTEREST",
    description: "Whatever doesn't fit anywhere else.",
  },
];

const ALL: Collection = { slug: "all", name: "Shop All", description: "Everything in the store." };
const BEST_SELLERS: Collection = {
  slug: "best-sellers",
  name: "Best Sellers",
  description: "What people are buying most.",
};
const JUST_IN: Collection = {
  slug: "just-in",
  name: "Just In",
  description: "The newest designs.",
};

/* ------------------------------------------------------------------ */
/* Sample products                                                     */
/* ------------------------------------------------------------------ */

const BLACK: CatalogColor = { name: "Black", hex: "#111111", ink: "#EDEAE3" };
const BONE: CatalogColor = { name: "Bone", hex: "#EDEAE3", ink: "#111111" };
const OLIVE: CatalogColor = { name: "Olive", hex: "#5E6B3F", ink: "#EDEAE3" };

const SIZES = ["S", "M", "L", "XL", "2XL"];

const SAMPLE_COPY = {
  shortDescription: "Sample product, here so you can see the layout.",
  description:
    "This is a sample product. The real description goes in this spot: two or three sentences about the design, how the shirt fits, and what it is printed on.",
  details: [
    "Sample detail. Fabric and weight go here.",
    "Sample detail. Print method goes here.",
    "Sample detail. Care instructions go here.",
  ],
  fit: "Sample fit note. Say how it runs and what size the model is wearing.",
};

const products: CatalogProduct[] = [
  {
    slug: "sample-tee-01",
    name: "Sample Tee 01",
    categories: ["t-shirts", "gaming"],
    priceCents: 3200,
    ...SAMPLE_COPY,
    colors: [BLACK, BONE, OLIVE],
    sizes: SIZES,
    graphic: "rings",
    addedOrder: 1,
    bestSellerRank: 1,
    isSample: true,
  },
  {
    slug: "sample-tee-02",
    name: "Sample Tee 02",
    categories: ["t-shirts", "music"],
    priceCents: 3200,
    ...SAMPLE_COPY,
    colors: [BONE, BLACK],
    sizes: SIZES,
    graphic: "grid",
    addedOrder: 2,
    bestSellerRank: null,
    isSample: true,
  },
  {
    slug: "sample-tee-03",
    name: "Sample Tee 03",
    categories: ["t-shirts", "film-and-tv", "halloween"],
    priceCents: 3400,
    ...SAMPLE_COPY,
    colors: [OLIVE, BLACK, BONE],
    sizes: SIZES,
    graphic: "bars",
    addedOrder: 3,
    bestSellerRank: 2,
    isSample: true,
  },
  {
    slug: "sample-tee-04",
    name: "Sample Tee 04",
    categories: ["t-shirts", "anime", "everything-else"],
    priceCents: 3400,
    ...SAMPLE_COPY,
    colors: [BLACK, OLIVE],
    sizes: SIZES,
    graphic: "arc",
    addedOrder: 4,
    bestSellerRank: null,
    isSample: true,
  },
];

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function getProducts(): CatalogProduct[] {
  return products;
}

export function getProductBySlug(slug: string): CatalogProduct | undefined {
  return products.find((product) => product.slug === slug);
}

export function getRelatedProducts(slug: string, limit = 3): CatalogProduct[] {
  return products.filter((product) => product.slug !== slug).slice(0, limit);
}

export function getCategories(kind?: CategoryKind): CatalogCategory[] {
  return kind ? categories.filter((category) => category.kind === kind) : categories;
}

/** The product-type category a product belongs to, for breadcrumbs and labels. */
export function getProductType(product: CatalogProduct): CatalogCategory | undefined {
  return categories.find(
    (category) => category.kind === "PRODUCT_TYPE" && product.categories.includes(category.slug),
  );
}

export function getCollections(): Collection[] {
  return [ALL, BEST_SELLERS, JUST_IN, ...categories];
}

export function getCollection(slug: string): Collection | undefined {
  return getCollections().find((collection) => collection.slug === slug);
}

export function getCollectionProducts(slug: string): CatalogProduct[] {
  switch (slug) {
    case ALL.slug:
      return products;
    case BEST_SELLERS.slug:
      return products
        .filter((product) => product.bestSellerRank !== null)
        .sort((a, b) => (a.bestSellerRank ?? 0) - (b.bestSellerRank ?? 0));
    case JUST_IN.slug:
      return [...products].sort((a, b) => b.addedOrder - a.addedOrder);
    default:
      return products.filter((product) => product.categories.includes(slug));
  }
}
