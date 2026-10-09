import { z } from "zod";
import { MAX_LINES, MAX_QUANTITY } from "@/lib/cart-limits";
import { getDb, hasDatabase } from "@/db";
import { type Sellable, findSellables } from "@/db/queries/catalog";
import { sampleCatalog } from "@/lib/catalog/sample";
import { siteConfig } from "@/lib/site-config";

/**
 * Turns what the browser says is in the cart into what the customer actually owes.
 * The browser sends only product, color, size and quantity. Every price here comes
 * from the database, read at that moment.
 */

export const cartLinesSchema = z
  .array(
    z.object({
      slug: z.string().min(1).max(120),
      color: z.string().min(1).max(60),
      size: z.string().min(1).max(20),
      quantity: z.number().int().min(1).max(MAX_QUANTITY),
    }),
  )
  .min(1)
  .max(MAX_LINES);

export type CartLineInput = z.infer<typeof cartLinesSchema>[number];

export type PricedLine = {
  slug: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  /** Product type slug, e.g. "t-shirts". Drives the shipping rate. */
  typeSlug: string | null;
};

export type PricedCart = {
  lines: PricedLine[];
  subtotalCents: number;
  shippingCents: number;
};

export type PriceResult = { ok: true; cart: PricedCart } | { ok: false; error: string };

/** What is on sale right now for these products. Read fresh, never from the cache. */
async function loadSellables(slugs: string[]): Promise<Sellable[]> {
  if (hasDatabase()) return findSellables(getDb(), slugs);

  // No database (a fresh local checkout): price from the sample products.
  return sampleCatalog()
    .products.filter((product) => slugs.includes(product.slug))
    .flatMap((product) =>
      product.colors.flatMap((color) =>
        product.sizes.map((size) => ({
          productId: product.slug,
          variantId: `${product.slug}:${color.name}:${size.size}`,
          slug: product.slug,
          name: product.name,
          color: color.name,
          size: size.size,
          sku: `${product.slug}-${color.name}-${size.size}`,
          priceCents: size.priceCents,
          typeSlug: product.typeSlug,
          imageUrl: null,
        })),
      ),
    );
}

export async function priceCart(input: CartLineInput[]): Promise<PriceResult> {
  // The same product, color and size sent twice is one line.
  const merged = new Map<string, CartLineInput>();
  for (const line of input) {
    const key = `${line.slug}:${line.color}:${line.size}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...line, quantity: existing.quantity + line.quantity } : line);
  }

  const sellables = await loadSellables([...new Set(input.map((line) => line.slug))]);

  const lines: PricedLine[] = [];
  for (const line of merged.values()) {
    const ofProduct = sellables.filter((sellable) => sellable.slug === line.slug);
    if (ofProduct.length === 0) {
      return { ok: false, error: "An item in your cart is no longer available." };
    }
    const name = ofProduct[0].name;
    const ofColor = ofProduct.filter((sellable) => sellable.color === line.color);
    if (ofColor.length === 0) {
      return { ok: false, error: `${name} is no longer available in ${line.color}.` };
    }
    const sellable = ofColor.find((candidate) => candidate.size === line.size);
    if (!sellable) {
      return { ok: false, error: `${name} is no longer available in size ${line.size}.` };
    }
    if (line.quantity > MAX_QUANTITY) {
      return { ok: false, error: `You can order up to ${MAX_QUANTITY} of each item.` };
    }
    lines.push({
      slug: line.slug,
      name,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      unitPriceCents: sellable.priceCents,
      typeSlug: sellable.typeSlug,
    });
  }

  return {
    ok: true,
    cart: {
      lines,
      subtotalCents: lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
      shippingCents: shippingFor(lines),
    },
  };
}

function rateFor(typeSlug: string | null) {
  const { rates, fallbackRate } = siteConfig.shipping;
  return (typeSlug && rates[typeSlug]) || fallbackRate;
}

/**
 * One item in the order pays the "first item" rate, and it is the item with the
 * highest one. Every other item pays its own "additional item" rate.
 */
export function shippingFor(lines: Pick<PricedLine, "typeSlug" | "quantity">[]): number {
  if (lines.length === 0) return 0;

  let first = rateFor(lines[0].typeSlug);
  let additionalTotal = 0;
  for (const line of lines) {
    const rate = rateFor(line.typeSlug);
    additionalTotal += rate.additional * line.quantity;
    if (rate.first > first.first) first = rate;
  }
  return first.first + additionalTotal - first.additional;
}
