import Link from "next/link";
import { primaryImage } from "@/lib/catalog/shape";
import type { CatalogProduct } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/money";
import { ProductArt } from "./product-art";

/** Where product cards sit in a grid: two across on phones, up to four on desktop. */
const CARD_SIZES = "(min-width: 1024px) 25vw, 50vw";

type ProductCardProps = {
  product: CatalogProduct;
  /** Load the picture straight away. For the first cards on a page. */
  priority?: boolean;
};

export function ProductCard({ product, priority = false }: ProductCardProps) {
  const color = product.colors[0];
  const hasSizePricing = product.sizes.some((size) => size.priceCents !== product.priceCents);
  const wasCents =
    product.compareAtPriceCents && product.compareAtPriceCents > product.priceCents
      ? product.compareAtPriceCents
      : null;

  return (
    <article className="group relative flex flex-col gap-3.5">
      <div className="well relative aspect-[4/5] overflow-hidden transition-shadow duration-300 group-hover:shadow-[inset_0_0_0_1px_rgb(237_234_227/0.28),0_24px_48px_-28px_var(--glow)]">
        <ProductArt
          image={primaryImage(product)}
          label={`${product.name} in ${color.name}`}
          color={color}
          graphic={product.graphic}
          sizes={CARD_SIZES}
          priority={priority}
          className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {wasCents ? <span className="tag tag-accent">Sale</span> : null}
          {product.isSample ? <span className="tag">Sample</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 font-semibold leading-snug">
            {/* The link covers the whole card, picture included. */}
            <Link
              href={`/products/${product.slug}`}
              className="after:absolute after:inset-0 after:rounded-card hover:text-white"
            >
              {product.name}
            </Link>
          </h3>
          <p className="num flex-none text-[0.9375rem] font-semibold text-white">
            {hasSizePricing ? <span className="sr-only">From </span> : null}
            {wasCents ? (
              <>
                <span className="sr-only">Was </span>
                <s className="mr-1.5 font-normal text-smoke">{formatMoney(wasCents)}</s>
                <span className="sr-only">Now </span>
              </>
            ) : null}
            {formatMoney(product.priceCents)}
            {hasSizePricing ? <span aria-hidden="true">+</span> : null}
          </p>
        </div>

        <ul className="flex items-center gap-1.5" aria-label="Available colors">
          {product.colors.map((option) => (
            <li
              key={option.name}
              title={option.name}
              className="h-3.5 w-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(237_234_227/0.35)]"
              style={{ background: option.hex }}
            >
              <span className="sr-only">{option.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
