import { z } from "zod";
import { MAX_LINES, MAX_QUANTITY } from "@/lib/cart-limits";
import { type CatalogProduct, getProductBySlug, getProductType } from "@/lib/catalog";
import { siteConfig } from "@/lib/site-config";

/**
 * Turns what the browser says is in the cart into what the customer actually owes.
 * The browser sends only product, color, size and quantity. Every price here comes
 * from the catalog on the server.
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
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  product: CatalogProduct;
  /** Product type slug, e.g. "t-shirts". Drives the shipping rate. */
  typeSlug: string | null;
};

export type PricedCart = {
  lines: PricedLine[];
  subtotalCents: number;
  shippingCents: number;
};

export type PriceResult = { ok: true; cart: PricedCart } | { ok: false; error: string };

export function priceCart(input: CartLineInput[]): PriceResult {
  // The same product, color and size sent twice is one line.
  const merged = new Map<string, CartLineInput>();
  for (const line of input) {
    const key = `${line.slug}:${line.color}:${line.size}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...line, quantity: existing.quantity + line.quantity } : line);
  }

  const lines: PricedLine[] = [];
  for (const line of merged.values()) {
    const product = getProductBySlug(line.slug);
    if (!product) return { ok: false, error: "An item in your cart is no longer available." };
    if (!product.colors.some((color) => color.name === line.color)) {
      return { ok: false, error: `${product.name} is no longer available in ${line.color}.` };
    }
    if (!product.sizes.includes(line.size)) {
      return { ok: false, error: `${product.name} is no longer available in size ${line.size}.` };
    }
    if (line.quantity > MAX_QUANTITY) {
      return { ok: false, error: `You can order up to ${MAX_QUANTITY} of each item.` };
    }
    lines.push({
      slug: line.slug,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      unitPriceCents: product.priceCents,
      product,
      typeSlug: getProductType(product)?.slug ?? null,
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
