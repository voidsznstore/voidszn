"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ProductArt } from "@/components/product/product-art";
import {
  MAX_QUANTITY,
  lineKey,
  removeFromCart,
  removeUnavailable,
  setQuantity,
  useCart,
} from "@/lib/cart-store";
import type { CartArt, CartView } from "@/lib/cart-view";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";
import { useCartUi } from "./cart-provider";

/**
 * Asks the server what to show for the lines in the cart: names, prices and
 * pictures. Only runs while the cart is open, and only when the set of products
 * in it changes; quantity changes don't need a new answer.
 */
function useCartView(keys: string, isOpen: boolean): CartView | null {
  const [answer, setAnswer] = useState<{ keys: string; view: CartView } | null>(null);

  useEffect(() => {
    if (!isOpen || keys === "[]") return;
    const controller = new AbortController();

    (async () => {
      try {
        const lines = (JSON.parse(keys) as [string, string, string][]).map(
          ([slug, color, size]) => ({ slug, color, size }),
        );
        const response = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const view = (await response.json()) as CartView;
        setAnswer({ keys, view });
        removeUnavailable(view.unavailable);
      } catch {
        // A failed lookup leaves the last answer on screen. Checkout still works.
      }
    })();

    return () => controller.abort();
  }, [keys, isOpen]);

  // The last answer stays up while a newer one loads, so the cart never blanks.
  return answer?.view ?? null;
}

function Thumb({ art, className }: { art: CartArt; className: string }) {
  return (
    <span className={`relative block flex-none overflow-hidden bg-well ${className}`}>
      <ProductArt
        image={art.image}
        label=""
        color={art.swatch}
        graphic={art.graphic}
        sizes="6rem"
        padding="p-2"
      />
    </span>
  );
}

export function CartDrawer() {
  const { isOpen, closeCart } = useCartUi();
  const { lines, count } = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // A native dialog gives focus trapping, Escape to close and a backdrop for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const keys = JSON.stringify(lines.map((line) => [line.slug, line.color, line.size]));
  const view = useCartView(keys, isOpen);
  const info = new Map(view?.items.map((item) => [item.key, item]));

  const rows = lines.map((line) => ({ line, key: lineKey(line), item: info.get(lineKey(line)) }));
  const isPriced = rows.every((row) => row.item);
  const subtotalCents = rows.reduce(
    (total, row) => total + (row.item?.unitPriceCents ?? 0) * row.line.quantity,
    0,
  );
  const inCart = new Set(lines.map((line) => line.slug));
  const suggestions = (view?.suggestions ?? []).filter((product) => !inCart.has(product.slug));

  return (
    <dialog
      ref={dialogRef}
      onClose={closeCart}
      onClick={(event) => {
        // A click on the dimmed area outside the panel closes the cart.
        if (event.target === dialogRef.current) closeCart();
      }}
      aria-label="Cart"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-[30rem] border-l border-line bg-void p-0 text-bone backdrop:bg-black/70"
    >
      <div className="flex h-full flex-col">
        <div className="flex min-h-[4.25rem] items-center justify-between border-b border-line px-6">
          <h2 className="display text-[1.75rem] text-white">Your cart ({count})</h2>
          <button
            type="button"
            onClick={closeCart}
            className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:text-white"
          >
            Close
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
            <p className="text-bone-dim">Your cart is empty.</p>
            <Link href="/collections/all" onClick={closeCart} className="btn btn-accent">
              Shop all
            </Link>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-6">
              <ul aria-busy={!isPriced}>
                {rows.map(({ line, key, item }) => {
                  // Shown from what was picked until the server's details arrive.
                  const name = item?.name ?? "Loading…";
                  return (
                    <li key={key} className="flex gap-4 border-b border-line py-5">
                      <Link
                        href={`/products/${line.slug}`}
                        onClick={closeCart}
                        aria-label={name}
                        className="flex-none"
                      >
                        {item ? (
                          <Thumb art={item} className="h-[6.875rem] w-[5.5rem]" />
                        ) : (
                          <span className="block h-[6.875rem] w-[5.5rem] bg-well" />
                        )}
                      </Link>

                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex justify-between gap-3">
                          <Link
                            href={`/products/${line.slug}`}
                            onClick={closeCart}
                            className={`font-semibold hover:text-white ${item ? "" : "text-smoke"}`}
                          >
                            {name}
                          </Link>
                          <span className="font-mono text-sm">
                            {item ? formatMoney(item.unitPriceCents * line.quantity) : ""}
                          </span>
                        </div>
                        <p className="label text-xs text-smoke">
                          {line.color} / {line.size}
                        </p>

                        <div className="mt-auto flex items-center justify-between">
                          <div className="flex items-center border border-line-strong">
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${name}`}
                              disabled={line.quantity <= 1}
                              onClick={() => setQuantity(key, line.quantity - 1)}
                              className="h-11 w-11 text-lg disabled:text-line-strong"
                            >
                              -
                            </button>
                            <span
                              aria-live="polite"
                              className="min-w-7 text-center font-mono text-sm"
                            >
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${name}`}
                              disabled={line.quantity >= MAX_QUANTITY}
                              onClick={() => setQuantity(key, line.quantity + 1)}
                              className="h-11 w-11 text-lg disabled:text-line-strong"
                            >
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(key)}
                            aria-label={`Remove ${name} from cart`}
                            className="inline-flex min-h-11 items-center text-[0.8125rem] text-smoke underline underline-offset-4 hover:text-bone"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {suggestions.length > 0 ? (
                <div className="flex flex-col gap-3 py-5">
                  <h3 className="label text-xs text-smoke">You may also like</h3>
                  {suggestions.map((product) => (
                    <div key={product.slug} className="flex items-center gap-3.5">
                      <Thumb art={product} className="h-[4.375rem] w-14" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{product.name}</p>
                        <p className="font-mono text-[0.8125rem] text-smoke">
                          {formatMoney(product.priceCents)}
                        </p>
                      </div>
                      <Link
                        href={`/products/${product.slug}`}
                        onClick={closeCart}
                        aria-label={`View ${product.name}`}
                        className="inline-flex min-h-11 min-w-[4.5rem] items-center justify-center border border-line-strong text-sm font-semibold hover:border-bone"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-line px-6 pb-6 pt-5">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Subtotal</span>
                <span className="font-mono text-lg text-white">
                  {isPriced ? formatMoney(subtotalCents) : "…"}
                </span>
              </div>
              <p className="text-[0.8125rem] text-smoke">Shipping is added at checkout.</p>
              <Link
                href="/checkout"
                onClick={closeCart}
                className="btn btn-accent min-h-[3.625rem] w-full text-[1.0625rem]"
              >
                Checkout
              </Link>
              <p className="text-center text-[0.8125rem] text-smoke">
                Printed to order. Damaged or wrong items are replaced or refunded within{" "}
                {siteConfig.orders.issueWindowDays} days.{" "}
                <Link href="/returns" onClick={closeCart} className="underline underline-offset-4">
                  Returns policy
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
