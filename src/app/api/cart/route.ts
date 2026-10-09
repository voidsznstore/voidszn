import { z } from "zod";
import { MAX_LINES } from "@/lib/cart-limits";
import type { CartView } from "@/lib/cart-view";
import { getProducts } from "@/lib/catalog";
import { primaryImage } from "@/lib/catalog/shape";

const linesSchema = z
  .array(
    z.object({
      slug: z.string().min(1).max(120),
      color: z.string().min(1).max(60),
      size: z.string().min(1).max(20),
    }),
  )
  .max(MAX_LINES * 2);

const MAX_BODY_BYTES = 16_000;

/**
 * Looks up what the cart should show for each line: name, price and picture.
 * This is for display only. Checkout prices the cart again, from the database.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Too large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Unreadable" }, { status: 400 });
  }
  const parsed = linesSchema.safeParse((body as { lines?: unknown } | null)?.lines);
  if (!parsed.success) return Response.json({ error: "Unreadable" }, { status: 400 });

  const products = await getProducts();
  const view: CartView = { items: [], unavailable: [], suggestions: [] };
  const inCart = new Set<string>();

  for (const line of parsed.data) {
    const key = `${line.slug}:${line.color}:${line.size}`;
    const product = products.find((candidate) => candidate.slug === line.slug);
    const color = product?.colors.find((candidate) => candidate.name === line.color);
    const size = product?.sizes.find((candidate) => candidate.size === line.size);
    if (!product || !color || !size) {
      view.unavailable.push(key);
      continue;
    }
    inCart.add(product.slug);
    view.items.push({
      key,
      slug: product.slug,
      name: product.name,
      color: color.name,
      size: size.size,
      unitPriceCents: size.priceCents,
      image: primaryImage(product, color),
      swatch: { hex: color.hex, ink: color.ink },
      graphic: product.graphic,
    });
  }

  view.suggestions = products
    .filter((product) => !inCart.has(product.slug))
    .slice(0, 2)
    .map((product) => ({
      slug: product.slug,
      name: product.name,
      priceCents: product.priceCents,
      image: primaryImage(product),
      swatch: { hex: product.colors[0].hex, ink: product.colors[0].ink },
      graphic: product.graphic,
    }));

  return Response.json(view);
}
