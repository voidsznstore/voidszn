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

  return (
    <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Gallery */}
      <div className="flex flex-col gap-3">
        <div className="relative aspect-[4/5] overflow-hidden bg-well">
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
        {shotCount > 1 ? (
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: shotCount }, (_, index) => (
              <button
                key={hasPhotos ? photos[index].url : VIEWS[index]}
                type="button"
                aria-label={hasPhotos ? `Show photo ${index + 1}` : `Show ${VIEWS[index]}`}
                aria-pressed={current === index}
                onClick={() => setShot(index)}
                className={`relative aspect-square overflow-hidden bg-well ${
                  current === index ? "outline outline-1 outline-bone" : "hover:bg-well-hover"
                }`}
              >
                <ProductArt
                  image={hasPhotos ? photos[index] : null}
                  label=""
                  color={color}
                  graphic={product.graphic}
                  view={hasPhotos ? undefined : VIEWS[index]}
                  sizes={THUMB_SIZES}
                  padding="p-3"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Details */}
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-3">
          <p className="label text-accent">{typeName}</p>
          <h1 className="display text-[clamp(2.5rem,5vw,3.75rem)] text-white">{product.name}</h1>
          <p className="font-mono text-2xl text-white">
            {sizePricingVaries && !chosenSize ? "From " : ""}
            {formatMoney(priceCents)}
          </p>
          {product.description ? <p className="text-bone-dim">{product.description}</p> : null}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="label mb-3 text-smoke">
            Color / <span className="text-bone">{color.name}</span>
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
                className="h-11 w-11 rounded-full"
                style={{
                  background: option.hex,
                  boxShadow:
                    index === colorIndex
                      ? "0 0 0 3px var(--color-void), 0 0 0 5px var(--color-bone)"
                      : "0 0 0 1px var(--color-line-strong)",
                }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="label mb-3 text-smoke">
            Size / <span className="text-bone">{size ?? "Select"}</span>
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
                className={`min-h-12 min-w-[3.75rem] border px-3 font-mono text-sm transition-colors ${
                  size === option.size
                    ? "border-bone bg-bone text-void"
                    : "border-line-strong text-bone hover:border-bone"
                }`}
              >
                {option.size}
              </button>
            ))}
          </div>
          <details className="text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
              Size guide
            </summary>
            <p className="pb-2 text-bone-dim">
              Not sure which size? See the{" "}
              <Link href="/size-guide" className="underline underline-offset-4">
                size guide and how to measure
              </Link>
              .
            </p>
          </details>
        </fieldset>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleAddToCart}
            className="btn btn-accent min-h-[3.625rem] w-full text-[1.0625rem]"
          >
            {size ? "Add to cart" : "Select a size"}
          </button>
          <p aria-live="polite" className="min-h-5 text-sm text-bone-dim">
            {message}
          </p>
        </div>

        <div className="flex flex-col gap-1 border border-line bg-ash-soft px-[1.125rem] py-4">
          <p className="font-semibold">Printed to order</p>
          <p className="text-[0.9375rem] text-bone-dim">{SHIPPING_NOTE}</p>
        </div>

        <div className="border-t border-line">
          {product.details.length > 0 ? (
            <details open className="border-b border-line">
              <summary className="flex min-h-[3.25rem] cursor-pointer items-center font-semibold">
                Details
              </summary>
              <ul className="list-disc pb-4 pl-5 text-[0.9375rem] text-bone-dim">
                {product.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {product.fit ? (
            <details className="border-b border-line">
              <summary className="flex min-h-[3.25rem] cursor-pointer items-center font-semibold">
                Size and fit
              </summary>
              <p className="pb-4 text-[0.9375rem] text-bone-dim">{product.fit}</p>
            </details>
          ) : null}
          <details className="border-b border-line">
            <summary className="flex min-h-[3.25rem] cursor-pointer items-center font-semibold">
              Shipping and returns
            </summary>
            <p className="pb-4 text-[0.9375rem] text-bone-dim">
              {SHIPPING_NOTE} Every item is made to order, so we can&apos;t take returns for a
              change of mind or a wrong size. If it arrives damaged, defective or wrong, tell us
              within {orders.issueWindowDays} days and we&apos;ll replace or refund it. Full
              details:{" "}
              <Link href="/shipping" className="underline underline-offset-4">
                shipping
              </Link>{" "}
              and{" "}
              <Link href="/returns" className="underline underline-offset-4">
                returns
              </Link>
              .
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
