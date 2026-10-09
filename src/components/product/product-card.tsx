import Link from "next/link";
import { primaryImage } from "@/lib/catalog/shape";
import type { CatalogProduct } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/money";
import { ProductArt } from "./product-art";

/** Where product cards sit in a grid: two across on phones, up to five on desktop. */
const CARD_SIZES = "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw";

type ProductCardProps = {
  product: CatalogProduct;
  /** Load the picture straight away. For the first cards on a page. */
  priority?: boolean;
};

/** A picture with a quiet caption under it: the name, and the price beside it. */
export function ProductCard({ product, priority = false }: ProductCardProps) {
  const color = product.colors[0];
  const hasSizePricing = product.sizes.some((size) => size.priceCents !== product.priceCents);
  const wasCents =
    product.compareAtPriceCents && product.compareAtPriceCents > product.priceCents
      ? product.compareAtPriceCents
      : null;

  return (
    <article className="group relative flex flex-col gap-3">
      <div className="well relative aspect-[4/5] overflow-hidden !rounded-field transition-shadow duration-300 group-hover:shadow-[inset_0_0_0_1px_rgb(237_234_227/0.28),0_24px_48px_-28px_var(--glow)]">
        <ProductArt
          image={primaryImage(product)}
          label={`${product.name} in ${color.name}`}
          color={color}
          graphic={product.graphic}
          sizes={CARD_SIZES}
          priority={priority}
          className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
          {wasCents ? <span className="tag tag-accent">Sale</span> : null}
          {product.isSample ? <span className="tag">Sample</span> : null}
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 px-0.5">
        <h3 className="label min-w-0 text-[0.8125rem] leading-snug text-bone">
          {/* The link covers the whole card, picture included. */}
          <Link
            href={`/products/${product.slug}`}
            className="after:absolute after:inset-0 after:rounded-field group-hover:text-white"
          >
            {product.name}
          </Link>
        </h3>
        <p className="num flex-none text-[0.8125rem] leading-snug text-smoke">
          {hasSizePricing ? <span className="sr-only">From </span> : null}
          {wasCents ? (
            <>
              <span className="sr-only">Was </span>
              <s className="mr-1.5">{formatMoney(wasCents)}</s>
              <span className="sr-only">Now </span>
            </>
          ) : null}
          <span className={wasCents ? "font-semibold text-ember" : "text-bone-dim"}>
            {formatMoney(product.priceCents)}
            {hasSizePricing ? <span aria-hidden="true">+</span> : null}
          </span>
        </p>
      </div>
    </article>
  );
}
