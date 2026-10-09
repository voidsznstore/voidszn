"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useCartUi } from "@/components/cart/cart-provider";
import { addToCart } from "@/lib/cart-store";
import { imagesFor } from "@/lib/catalog/shape";
import type { CatalogProduct } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";
import { ProductArt } from "./product-art";

type View = "front" | "back";
const VIEWS: View[] = ["front", "back"];

const { shipping, orders } = siteConfig;
const SHIPPING_NOTE = `Made for you after you order, usually within ${shipping.productionDays} business days. Standard shipping then takes ${shipping.transitDays} business days, with tracking sent by email.`;

const MAIN_SIZES = "(min-width: 1024px) 45vw, 100vw";
const THUMB_SIZES = "(min-width: 1024px) 11vw, 25vw";

type ProductViewProps = {
  product: CatalogProduct;
  /** The trail back to the shop, shown above the title. */
  crumbs: React.ReactNode;
};

export function ProductView({ product, crumbs }: ProductViewProps) {
  const [colorIndex, setColorIndex] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  // Which picture is showing: a photo number, or front/back of the stand-in drawing.
  const [shot, setShot] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { openCart } = useCartUi();
  const sizeLabel = useId();

  const color = product.colors[colorIndex];
  const photos = imagesFor(product, color);
  const hasPhotos = photos.length > 0;
  const shotCount = hasPhotos ? photos.length : VIEWS.length;
  const current = Math.min(shot, shotCount - 1);

  const chosenSize = product.sizes.find((option) => option.size === size);
  const sizePricingVaries = product.sizes.some((option) => option.priceCents !== product.priceCents);
  const priceCents = chosenSize?.priceCents ?? product.priceCents;
  const wasCents =
    product.compareAtPriceCents && product.compareAtPriceCents > priceCents
      ? product.compareAtPriceCents
      : null;

  function handleAddToCart() {
    if (!size) {
      setMessage("Pick a size first.");
      return;
    }
    addToCart({ slug: product.slug, color: color.name, size });
    setMessage(null);
    openCart();
  }

  const step = (by: number) => setShot((current + by + shotCount) % shotCount);
  const arrow =
    "glass absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-bone transition-colors hover:text-white";

  return (
    <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-2 xl:gap-x-16">
      {/* Pictures */}
      <div className="flex flex-col gap-3">
        <div className="well relative aspect-[4/5] overflow-hidden">
          <ProductArt
            image={hasPhotos ? photos[current] : null}
            label={`${product.name} in ${color.name}${hasPhotos ? "" : `, ${VIEWS[current]}`}`}
            color={color}
            graphic={product.graphic}
            view={hasPhotos ? undefined : VIEWS[current]}
            sizes={MAIN_SIZES}
            padding="p-10 sm:p-16"
            priority
          />
          {shotCount > 1 ? (
            <>
              <button type="button" aria-label="Previous picture" onClick={() => step(-1)} className={`${arrow} left-3`}>
                <Chevron direction="left" />
              </button>
              <button type="button" aria-label="Next picture" onClick={() => step(1)} className={`${arrow} right-3`}>
                <Chevron direction="right" />
              </button>
              <p aria-live="polite" className="tag absolute bottom-3 left-1/2 -translate-x-1/2">
                {current + 1} / {shotCount}
              </p>
            </>
          ) : null}
        </div>
        {shotCount > 1 ? (
          <div className="grid grid-cols-6 gap-2">
            {Array.from({ length: shotCount }, (_, index) => (
              <button
                key={hasPhotos ? photos[index].url : VIEWS[index]}
                type="button"
                aria-label={hasPhotos ? `Show photo ${index + 1}` : `Show ${VIEWS[index]}`}
                aria-pressed={current === index}
                onClick={() => setShot(index)}
                className={`well relative aspect-square overflow-hidden !rounded-[0.625rem] transition-shadow ${
                  current === index
                    ? "shadow-[inset_0_0_0_2px_var(--color-bone)]"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                <ProductArt
                  image={hasPhotos ? photos[index] : null}
                  label=""
                  color={color}
                  graphic={product.graphic}
                  view={hasPhotos ? undefined : VIEWS[index]}
                  sizes={THUMB_SIZES}
                  padding="p-2"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Details */}
      <div className="flex flex-col lg:sticky lg:top-24 lg:max-w-xl">
        {crumbs}

        <h1 className="mt-4 text-[clamp(1.875rem,3.6vw,2.875rem)] font-medium leading-[1.06] tracking-[-0.015em] text-white">
          {product.name}
        </h1>

        <div role="group" aria-labelledby={sizeLabel} className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p id={sizeLabel} className="label text-smoke">
              Size{size ? <span className="text-bone">: {size}</span> : null}
            </p>
            <Link href="/size-guide" className="label link inline-flex min-h-8 items-center text-smoke">
              Size guide
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {product.sizes.map((option) => (
              <button
                key={option.size}
                type="button"
                aria-pressed={size === option.size}
                onClick={() => {
                  setSize(option.size);
                  setMessage(null);
                }}
                className="chip min-h-11 min-w-[3.25rem] px-3.5"
              >
                {option.size}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="mt-6">
          <legend className="label mb-3 text-smoke">
            Color<span className="text-bone">: {color.name}</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {product.colors.map((option, index) => (
              <button
                key={option.name}
                type="button"
                aria-label={option.name}
                aria-pressed={index === colorIndex}
                onClick={() => {
                  setColorIndex(index);
                  setShot(0);
                }}
                className="h-9 w-9 rounded-full transition-shadow"
                style={{
                  background: option.hex,
                  boxShadow:
                    index === colorIndex
                      ? "0 0 0 3px var(--color-void), 0 0 0 5px var(--color-bone)"
                      : "inset 0 0 0 1px rgb(237 234 227 / 0.35)",
                }}
              />
            ))}
          </div>
        </fieldset>

        <p className="num mt-8 flex flex-wrap items-baseline gap-x-3 text-[1.75rem] font-medium text-white">
          <span>
            {sizePricingVaries && !chosenSize ? "From " : ""}
            {formatMoney(priceCents)}
          </span>
          {wasCents ? (
            <>
              <s className="text-lg font-normal text-smoke">
                <span className="sr-only">Was </span>
                {formatMoney(wasCents)}
              </s>
              <span className="tag tag-accent">Sale</span>
            </>
          ) : null}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleAddToCart}
            className="btn btn-accent min-h-14 w-full text-[1.0625rem]"
          >
            {size ? "Add to cart" : "Select a size"}
          </button>
          <p aria-live="polite" className="min-h-5 text-center text-sm text-ember">
            {message}
          </p>
        </div>

        <div className="mt-3 border-t border-line">
          {product.description ? (
            <Fold title="Description" open>
              <p>{product.description}</p>
            </Fold>
          ) : null}
          {product.details.length > 0 ? (
            <Fold title="Details">
              <ul className="list-disc pl-5 marker:text-accent">
                {product.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </Fold>
          ) : null}
          {product.fit ? (
            <Fold title="Size and fit">
              <p>{product.fit}</p>
            </Fold>
          ) : null}
          <Fold title="Shipping and returns">
            <p>
              {SHIPPING_NOTE} Every item is made to order, so we can&apos;t take returns for a
              change of mind or a wrong size. If it arrives damaged, defective or wrong, tell us
              within {orders.issueWindowDays} days and we&apos;ll replace or refund it. Full
              details:{" "}
              <Link href="/shipping" className="link">
                shipping
              </Link>{" "}
              and{" "}
              <Link href="/returns" className="link">
                returns
              </Link>
              .
            </p>
          </Fold>
        </div>
      </div>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 14"
      className={`h-3.5 w-2 ${direction === "left" ? "" : "rotate-180"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 1 1 7l6 6" />
    </svg>
  );
}

/** A section that opens and closes, with a plus that turns into a minus. */
function Fold({
  title,
  open = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group border-b border-line">
      <summary className="label flex min-h-14 list-none items-center justify-between gap-4 text-bone hover:text-white">
        {title}
        <span aria-hidden="true" className="relative h-3 w-3 flex-none">
          <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
          <span className="absolute left-1/2 top-0 h-full w-px bg-current transition-transform group-open:rotate-90 group-open:opacity-0" />
        </span>
      </summary>
      <div className="pb-5 text-[0.9375rem] leading-relaxed text-bone-dim">{children}</div>
    </details>
  );
}
