/**
 * SAMPLE DATA. Used only when no database is configured (for example a fresh
 * local checkout), so the storefront still has something to show. The live store
 * reads its catalog from the database.
 */
import { graphicFor } from "./shape";
import type {
  Catalog,
  CatalogCategory,
  CatalogColor,
  CatalogProduct,
  Collection,
  Graphic,
} from "./types";

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

export const ALL: Collection = { slug: "all", name: "Shop All", description: "Everything in the store." };
export const BEST_SELLERS: Collection = {
  slug: "best-sellers",
  name: "Best Sellers",
  description: "What people are buying most.",
};
export const JUST_IN: Collection = {
  slug: "just-in",
  name: "Just In",
  description: "The newest designs.",
};

/* ------------------------------------------------------------------ */
/* Sample products                                                     */
/* ------------------------------------------------------------------ */

const BLACK: CatalogColor = { name: "Black", hex: "#111111", ink: "#EDEAE3", images: [] };
const BONE: CatalogColor = { name: "Bone", hex: "#EDEAE3", ink: "#111111", images: [] };
const OLIVE: CatalogColor = { name: "Olive", hex: "#5E6B3F", ink: "#EDEAE3", images: [] };

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

type SampleProduct = {
  slug: string;
  name: string;
  categories: string[];
  priceCents: number;
  colors: CatalogColor[];
  graphic: Graphic;
  addedOrder: number;
  bestSellerRank: number | null;
};

const samples: SampleProduct[] = [
  {
    slug: "sample-tee-01",
    name: "Sample Tee 01",
    categories: ["t-shirts", "gaming"],
    priceCents: 3200,
    colors: [BLACK, BONE, OLIVE],
    graphic: "rings",
    addedOrder: 1,
    bestSellerRank: 1,
  },
  {
    slug: "sample-tee-02",
    name: "Sample Tee 02",
    categories: ["t-shirts", "music"],
    priceCents: 3200,
    colors: [BONE, BLACK],
    graphic: "grid",
    addedOrder: 2,
    bestSellerRank: null,
  },
  {
    slug: "sample-tee-03",
    name: "Sample Tee 03",
    categories: ["t-shirts", "film-and-tv", "halloween"],
    priceCents: 3400,
    colors: [OLIVE, BLACK, BONE],
    graphic: "bars",
    addedOrder: 3,
    bestSellerRank: 2,
  },
  {
    slug: "sample-tee-04",
    name: "Sample Tee 04",
    categories: ["t-shirts", "anime", "everything-else"],
    priceCents: 3400,
    colors: [BLACK, OLIVE],
    graphic: "arc",
    addedOrder: 4,
    bestSellerRank: null,
  },
];

/* ------------------------------------------------------------------ */
/* As a catalog                                                        */
/* ------------------------------------------------------------------ */

export const SAMPLE_CATEGORIES = categories;
export const SAMPLE_PRODUCTS = samples;
export const SAMPLE_SIZES = SIZES;
export { SAMPLE_COPY };

export function sampleCatalog(): Catalog {
  const products: CatalogProduct[] = samples.map((sample) => {
    const type = categories.find(
      (category) => category.kind === "PRODUCT_TYPE" && sample.categories.includes(category.slug),
    );
    return {
      slug: sample.slug,
      name: sample.name,
      categories: sample.categories,
      typeSlug: type?.slug ?? null,
      typeName: type?.name ?? null,
      priceCents: sample.priceCents,
      compareAtPriceCents: null,
      ...SAMPLE_COPY,
      colors: sample.colors,
      sizes: SIZES.map((size) => ({ size, priceCents: sample.priceCents })),
      images: [],
      graphic: sample.graphic ?? graphicFor(sample.slug),
      createdAt: sample.addedOrder,
      isSample: true,
    };
  });

  return {
    categories,
    products,
    bestSellers: samples
      .filter((sample) => sample.bestSellerRank !== null)
      .sort((a, b) => (a.bestSellerRank ?? 0) - (b.bestSellerRank ?? 0))
      .map((sample) => sample.slug),
    categoryProducts: Object.fromEntries(
      categories.map((category) => [
        category.slug,
        samples
          .filter((sample) => sample.categories.includes(category.slug))
          .map((sample) => sample.slug),
      ]),
    ),
  };
}
