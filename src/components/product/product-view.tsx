"use client";

import Link from "next/link";
import { useState } from "react";
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
  /** Product type shown above the title, e.g. "T-Shirts". */
  typeName: string;
};

export function ProductView({ product, typeName }: ProductViewProps) {
  const [colorIndex, setColorIndex] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  // Which picture is showing: a photo number, or front/back of the stand-in drawing.
  const [shot, setShot] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { openCart } = useCartUi();

  const color = product.colors[colorIndex];
  const photos = imagesFor(product, color);
  const hasPhotos = photos.length > 0;
  const shotCount = hasPhotos ? photos.length : VIEWS.length;
  const current = Math.min(shot, shotCount - 1);

  const chosenSize = product.sizes.find((option) => option.size === size);
  const sizePricingVaries = product.sizes.some((option) => option.priceCents !== product.priceCents);
  const priceCents = chosenSize?.priceCents ?? product.priceCents;

  function handleAddToCart() {
    if (!size) {
      setMessage("Pick a size first.");
      return;
    }
    addToCart({ slug: product.slug, color: color.name, size });
    setMessage(null);
    openCart();
  }

  const wasCents =
    product.compareAtPriceCents && product.compareAtPriceCents > priceCents
      ? product.compareAtPriceCents
      : null;

  return (
    <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Gallery */}
      <div className="flex flex-col gap-5">
        <div className="corners mx-3 mt-3 sm:mx-0 sm:mt-0">
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
          </div>
        </div>
        {shotCount > 1 ? (
          <div className="mx-3 grid grid-cols-5 gap-2.5 sm:mx-0">
            {Array.from({ length: shotCount }, (_, index) => (
              <button
                key={hasPhotos ? photos[index].url : VIEWS[index]}
                type="button"
                aria-label={hasPhotos ? `Show photo ${index + 1}` : `Show ${VIEWS[index]}`}
                aria-pressed={current === index}
                onClick={() => setShot(index)}
                className={`well relative aspect-square overflow-hidden !rounded-field transition-shadow ${
                  current === index
                    ? "shadow-[inset_0_0_0_2px_var(--color-bone)]"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                <ProductArt
                  image={hasPhotos ? photos[index] : null}
                  label=""
                  color={color}
                  graphic={product.graphic}
                  view={hasPhotos ? undefined : VIEWS[index]}
                  sizes={THUMB_SIZES}
                  padding="p-2.5"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Details */}
      <div className="flex flex-col gap-7 lg:sticky lg:top-28">
        <div className="flex flex-col gap-3">
          <p className="label text-ember">{typeName}</p>
          <h1 className="display text-[clamp(2.5rem,5vw,3.75rem)] text-white">{product.name}</h1>
          <p className="num flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold text-white">
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
          {product.description ? (
            <p className="max-w-prose text-bone-dim">{product.description}</p>
          ) : null}
        </div>

        <fieldset>
          <legend className="mb-3 text-sm text-smoke">
            Color: <span className="font-semibold text-bone">{color.name}</span>
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
                className="h-11 w-11 rounded-full transition-shadow"
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

        <fieldset>
          <legend className="mb-3 text-sm text-smoke">
            Size: <span className="font-semibold text-bone">{size ?? "pick one"}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((option) => (
              <button
                key={option.size}
                type="button"
                aria-pressed={size === option.size}
                onClick={() => {
                  setSize(option.size);
                  setMessage(null);
                }}
                className="chip min-h-12 min-w-[3.5rem]"
              >
                {option.size}
              </button>
            ))}
          </div>
          <Link href="/size-guide" className="link mt-2 inline-flex min-h-11 items-center text-sm">
            Size guide
          </Link>
        </fieldset>

        <div className="flex flex-col gap-2">
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

        <div className="panel flex flex-col gap-1 px-5 py-4">
          <p className="font-semibold">Printed to order</p>
          <p className="text-[0.9375rem] text-bone-dim">{SHIPPING_NOTE}</p>
        </div>

        <div className="border-t border-line">
          {product.details.length > 0 ? (
            <Fold title="Details" open>
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
      <summary className="flex min-h-14 list-none items-center justify-between gap-4 font-semibold hover:text-white">
        {title}
        <span aria-hidden="true" className="relative h-3 w-3 flex-none">
          <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
          <span className="absolute left-1/2 top-0 h-full w-px bg-current transition-transform group-open:rotate-90 group-open:opacity-0" />
        </span>
      </summary>
      <div className="pb-5 text-[0.9375rem] text-bone-dim">{children}</div>
    </details>
  );
}
