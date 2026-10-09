"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ProductArt } from "@/components/product/product-art";
import {
  MAX_QUANTITY,
  lineKey,
  removeFromCart,
  setDiscountCode,
  setQuantity,
  useCart,
  useDiscountCode,
} from "@/lib/cart-store";
import type { CartArt } from "@/lib/cart-view";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";
import { useCartUi } from "./cart-provider";
import { useCartView } from "./use-cart-view";

export function CartThumb({ art, className }: { art: CartArt; className: string }) {
  return (
    <span className={`well relative block flex-none overflow-hidden !rounded-field ${className}`}>
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
  const savedCode = useDiscountCode();
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
      className="glass glass-deep my-2 ml-auto mr-2 h-[calc(100dvh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-[28rem] rounded-[1.75rem] p-0 text-bone backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:my-3 sm:mr-3 sm:h-[calc(100dvh-1.5rem)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-[4.5rem] flex-none items-center justify-between border-b border-line pl-6 pr-3.5">
          <h2 className="display text-[1.75rem] text-white">
            Your cart <span className="num text-smoke">({count})</span>
          </h2>
          <button type="button" onClick={closeCart} className="btn btn-glass btn-sm">
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
                          <CartThumb art={item} className="h-[6.875rem] w-[5.5rem]" />
                        ) : (
                          <span className="well block h-[6.875rem] w-[5.5rem] !rounded-field" />
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
                          <span className="num text-[0.9375rem] font-semibold text-white">
                            {item ? formatMoney(item.unitPriceCents * line.quantity) : ""}
                          </span>
                        </div>
                        <p className="text-sm text-smoke">
                          {line.color}, {line.size}
                        </p>

                        <div className="mt-auto flex items-center justify-between">
                          <div className="flex items-center rounded-full border border-line-strong bg-white/[0.04]">
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${name}`}
                              disabled={line.quantity <= 1}
                              onClick={() => setQuantity(key, line.quantity - 1)}
                              className="h-11 w-11 rounded-full text-lg hover:bg-white/10 disabled:text-line-strong disabled:hover:bg-transparent"
                            >
                              −
                            </button>
                            <span
                              aria-live="polite"
                              className="num min-w-7 text-center text-sm font-semibold"
                            >
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${name}`}
                              disabled={line.quantity >= MAX_QUANTITY}
                              onClick={() => setQuantity(key, line.quantity + 1)}
                              className="h-11 w-11 rounded-full text-lg hover:bg-white/10 disabled:text-line-strong disabled:hover:bg-transparent"
                            >
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(key)}
                            aria-label={`Remove ${name} from cart`}
                            className="link inline-flex min-h-11 items-center text-[0.8125rem] text-smoke"
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
                  <h3 className="label text-smoke">You may also like</h3>
                  {suggestions.map((product) => (
                    <div key={product.slug} className="flex items-center gap-3.5">
                      <CartThumb art={product} className="h-[4.375rem] w-14" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{product.name}</p>
                        <p className="num text-[0.8125rem] text-smoke">
                          {formatMoney(product.priceCents)}
                        </p>
                      </div>
                      <Link
                        href={`/products/${product.slug}`}
                        onClick={closeCart}
                        aria-label={`View ${product.name}`}
                        className="btn btn-glass btn-sm"
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
                <span className="num text-xl font-semibold text-white">
                  {isPriced ? formatMoney(subtotalCents) : "…"}
                </span>
              </div>
              {savedCode ? (
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-bone-dim">
                  <span className="tag tag-warn">{savedCode}</span>
                  comes off at checkout.
                  <button
                    type="button"
                    onClick={() => setDiscountCode(null)}
                    className="link inline-flex min-h-8 items-center text-smoke"
                  >
                    Remove
                  </button>
                </p>
              ) : null}
              <p className="text-[0.8125rem] text-smoke">
                Shipping is added at checkout{savedCode ? "" : ", where you can also enter a code"}.
              </p>
              <Link
                href="/checkout"
                onClick={closeCart}
                className="btn btn-accent min-h-14 w-full text-[1.0625rem]"
              >
                Checkout
              </Link>
              <p className="text-center text-[0.8125rem] text-smoke">
                Printed to order. Damaged or wrong items are replaced or refunded within{" "}
                {siteConfig.orders.issueWindowDays} days.{" "}
                <Link href="/returns" onClick={closeCart} className="link">
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
