import Link from "next/link";
import { primaryImage } from "@/lib/catalog/shape";
import type { CatalogProduct } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/money";
import { ProductArt } from "./product-art";

/** Where product cards sit in a grid: two across on phones, up to four on desktop. */
const CARD_SIZES = "(min-width: 1024px) 25vw, 50vw";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const color = product.colors[0];
  const hasSizePricing = product.sizes.some((size) => size.priceCents !== product.priceCents);

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={`/products/${product.slug}`}
        aria-label={product.name}
        className="relative block aspect-[4/5] overflow-hidden bg-well transition-colors group-hover:bg-well-hover"
      >
        <ProductArt
          image={primaryImage(product)}
          label={`${product.name} in ${color.name}`}
          color={color}
          graphic={product.graphic}
          sizes={CARD_SIZES}
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {product.isSample ? (
          <span className="label absolute left-3 top-3 bg-bone px-2 py-1 text-[0.6875rem] text-void">
            Sample
          </span>
        ) : null}
      </Link>

      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/products/${product.slug}`} className="font-semibold hover:text-white">
          {product.name}
        </Link>
        <span className="font-mono text-sm">
          {hasSizePricing ? <span className="sr-only">From </span> : null}
          {formatMoney(product.priceCents)}
          {hasSizePricing ? <span aria-hidden="true">+</span> : null}
        </span>
      </div>

      <ul className="flex items-center gap-2" aria-label="Available colors">
        {product.colors.map((option) => (
          <li
            key={option.name}
            title={option.name}
            className="h-3.5 w-3.5 rounded-full border border-line-strong"
            style={{ background: option.hex }}
          >
            <span className="sr-only">{option.name}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
