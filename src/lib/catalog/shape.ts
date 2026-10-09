import type { CatalogColor, CatalogImage, CatalogProduct, Graphic } from "./types";

/** Black or bone, whichever reads on the given garment color. */
export function inkFor(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#111111" : "#EDEAE3";
}

const GRAPHICS: Graphic[] = ["rings", "grid", "bars", "arc"];

/** Picks placeholder art for a product. The same product always gets the same one. */
export function graphicFor(slug: string): Graphic {
  let total = 0;
  for (const character of slug) total += character.charCodeAt(0);
  return GRAPHICS[total % GRAPHICS.length];
}

/** Photos to show for a color: that color's own first, then the shared ones. */
export function imagesFor(product: CatalogProduct, color: CatalogColor | undefined): CatalogImage[] {
  return [...(color?.images ?? []), ...product.images];
}

/** The single photo that represents a product on cards and in the cart, if it has one. */
export function primaryImage(
  product: CatalogProduct,
  color: CatalogColor | undefined = product.colors[0],
): CatalogImage | null {
  return imagesFor(product, color)[0] ?? null;
}
