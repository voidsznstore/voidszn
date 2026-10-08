import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";
import { TeeMockup } from "./tee-mockup";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const color = product.colors[0];

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={`/products/${product.slug}`}
        aria-label={product.name}
        className="relative flex aspect-[4/5] items-center justify-center bg-well p-8 transition-colors group-hover:bg-well-hover"
      >
        {product.isSample ? (
          <span className="label absolute left-3 top-3 bg-bone px-2 py-1 text-[0.6875rem] text-void">
            Sample
          </span>
        ) : null}
        <TeeMockup
          color={color.hex}
          ink={color.ink}
          graphic={product.graphic}
          label={`${product.name} in ${color.name}`}
          className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>

      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/products/${product.slug}`} className="font-semibold hover:text-white">
          {product.name}
        </Link>
        <span className="font-mono text-sm">{formatMoney(product.priceCents)}</span>
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
