import type { CatalogImage, Graphic } from "@/lib/catalog/types";

/** What the cart needs to draw one product. */
export type CartArt = {
  image: CatalogImage | null;
  swatch: { hex: string; ink: string };
  graphic: Graphic;
};

/** Display details for one cart line, looked up on the server. */
export type CartLineInfo = CartArt & {
  key: string;
  slug: string;
  name: string;
  color: string;
  size: string;
  unitPriceCents: number;
};

export type CartSuggestion = CartArt & {
  slug: string;
  name: string;
  priceCents: number;
};

export type CartView = {
  items: CartLineInfo[];
  /** Keys of lines that can't be bought any more. The cart drops them. */
  unavailable: string[];
  suggestions: CartSuggestion[];
};
