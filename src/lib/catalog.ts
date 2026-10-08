/**
 * Storefront catalog.
 *
 * SAMPLE DATA. These products exist so the homepage and product page can be seen
 * with something in them. They are replaced by database queries (and real photos)
 * once the store is connected to its database. Nothing here is a real listing.
 */

export type Graphic = "rings" | "grid" | "bars" | "arc";

export type CatalogColor = {
  name: string;
  /** Garment color. */
  hex: string;
  /** Print color on that garment. */
  ink: string;
};

export type CatalogProduct = {
  slug: string;
  name: string;
  category: string;
  priceCents: number;
  shortDescription: string;
  description: string;
  details: string[];
  fit: string;
  shipping: string;
  colors: CatalogColor[];
  sizes: string[];
  graphic: Graphic;
  isSample: boolean;
};

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
  shipping:
    "Printed after you order, then shipped with tracking. Production and delivery times go here once the supplier is confirmed.",
};

const products: CatalogProduct[] = [
  {
    slug: "sample-tee-01",
    name: "Sample Tee 01",
    category: "Tees",
    priceCents: 3200,
    ...SAMPLE_COPY,
    colors: [BLACK, BONE, OLIVE],
    sizes: SIZES,
    graphic: "rings",
    isSample: true,
  },
  {
    slug: "sample-tee-02",
    name: "Sample Tee 02",
    category: "Tees",
    priceCents: 3200,
    ...SAMPLE_COPY,
    colors: [BONE, BLACK],
    sizes: SIZES,
    graphic: "grid",
    isSample: true,
  },
  {
    slug: "sample-tee-03",
    name: "Sample Tee 03",
    category: "Tees",
    priceCents: 3400,
    ...SAMPLE_COPY,
    colors: [OLIVE, BLACK, BONE],
    sizes: SIZES,
    graphic: "bars",
    isSample: true,
  },
  {
    slug: "sample-tee-04",
    name: "Sample Tee 04",
    category: "Tees",
    priceCents: 3400,
    ...SAMPLE_COPY,
    colors: [BLACK, OLIVE],
    sizes: SIZES,
    graphic: "arc",
    isSample: true,
  },
];

export function getProducts(): CatalogProduct[] {
  return products;
}

export function getProductBySlug(slug: string): CatalogProduct | undefined {
  return products.find((product) => product.slug === slug);
}

export function getRelatedProducts(slug: string, limit = 3): CatalogProduct[] {
  return products.filter((product) => product.slug !== slug).slice(0, limit);
}
