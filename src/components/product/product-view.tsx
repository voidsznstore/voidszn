"use client";

import { useState } from "react";
import type { CatalogProduct } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";
import { TeeMockup } from "./tee-mockup";

type View = "front" | "back";
const VIEWS: View[] = ["front", "back"];

export function ProductView({ product }: { product: CatalogProduct }) {
  const [colorIndex, setColorIndex] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [view, setView] = useState<View>("front");
  const [message, setMessage] = useState<string | null>(null);

  const color = product.colors[colorIndex];

  function handleAddToCart() {
    if (!size) {
      setMessage("Pick a size first.");
      return;
    }
    // The cart is built in the next step. Until then this only confirms the selection.
    setMessage(`${color.name}, size ${size} selected. The cart is the next thing being built.`);
  }

  return (
    <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Gallery */}
      <div className="flex flex-col gap-3">
        <div className="flex aspect-[4/5] items-center justify-center bg-well p-10 sm:p-16">
          <TeeMockup
            color={color.hex}
            ink={color.ink}
            graphic={product.graphic}
            view={view}
            label={`${product.name} in ${color.name}, ${view}`}
            className="h-full w-full"
          />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Show ${option}`}
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`flex aspect-square items-center justify-center bg-well p-3 ${
                view === option ? "outline outline-1 outline-bone" : "hover:bg-well-hover"
              }`}
            >
              <TeeMockup
                color={color.hex}
                ink={color.ink}
                graphic={product.graphic}
                view={option}
                label=""
                className="h-full w-full"
              />
            </button>
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-3">
          <p className="label text-accent">{product.category}</p>
          <h1 className="display text-[clamp(2.5rem,5vw,3.75rem)] text-white">{product.name}</h1>
          <p className="font-mono text-2xl text-white">{formatMoney(product.priceCents)}</p>
          <p className="text-bone-dim">{product.description}</p>
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
                onClick={() => setColorIndex(index)}
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
                key={option}
                type="button"
                aria-pressed={size === option}
                onClick={() => {
                  setSize(option);
                  setMessage(null);
                }}
                className={`min-h-12 min-w-[3.75rem] border px-3 font-mono text-sm transition-colors ${
                  size === option
                    ? "border-bone bg-bone text-void"
                    : "border-line-strong text-bone hover:border-bone"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <details className="text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
              Size guide
            </summary>
            <p className="pb-2 text-bone-dim">
              Sample product. Chest and length measurements for each size go here.
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
          <p className="text-[0.9375rem] text-bone-dim">{product.shipping}</p>
        </div>

        <div className="border-t border-line">
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
          <details className="border-b border-line">
            <summary className="flex min-h-[3.25rem] cursor-pointer items-center font-semibold">
              Size and fit
            </summary>
            <p className="pb-4 text-[0.9375rem] text-bone-dim">{product.fit}</p>
          </details>
          <details className="border-b border-line">
            <summary className="flex min-h-[3.25rem] cursor-pointer items-center font-semibold">
              Shipping and returns
            </summary>
            <p className="pb-4 text-[0.9375rem] text-bone-dim">{product.shipping}</p>
          </details>
        </div>
      </div>
    </div>
  );
}
