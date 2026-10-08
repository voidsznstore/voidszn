"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { TeeMockup } from "@/components/product/tee-mockup";
import { MAX_QUANTITY, removeFromCart, setQuantity, useCart } from "@/lib/cart-store";
import { getProducts } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";
import { useCartUi } from "./cart-provider";

export function CartDrawer() {
  const { isOpen, closeCart } = useCartUi();
  const { items, count, subtotalCents } = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // A native dialog gives focus trapping, Escape to close and a backdrop for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const inCart = new Set(items.map((item) => item.slug));
  const suggestions = getProducts()
    .filter((product) => !inCart.has(product.slug))
    .slice(0, 2);

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

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
            <p className="text-bone-dim">Your cart is empty.</p>
            <Link href="/collections/all" onClick={closeCart} className="btn btn-accent">
              Shop all
            </Link>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-6">
              <ul>
                {items.map((item) => (
                  <li key={item.key} className="flex gap-4 border-b border-line py-5">
                    <Link
                      href={`/products/${item.slug}`}
                      onClick={closeCart}
                      aria-label={item.product.name}
                      className="flex h-[6.875rem] w-[5.5rem] flex-none items-center justify-center bg-well p-2"
                    >
                      <TeeMockup
                        color={item.colorOption.hex}
                        ink={item.colorOption.ink}
                        graphic={item.product.graphic}
                        label=""
                        className="h-full w-full"
                      />
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex justify-between gap-3">
                        <Link
                          href={`/products/${item.slug}`}
                          onClick={closeCart}
                          className="font-semibold hover:text-white"
                        >
                          {item.product.name}
                        </Link>
                        <span className="font-mono text-sm">
                          {formatMoney(item.lineTotalCents)}
                        </span>
                      </div>
                      <p className="label text-xs text-smoke">
                        {item.color} / {item.size}
                      </p>

                      <div className="mt-auto flex items-center justify-between">
                        <div className="flex items-center border border-line-strong">
                          <button
                            type="button"
                            aria-label={`Decrease quantity of ${item.product.name}`}
                            disabled={item.quantity <= 1}
                            onClick={() => setQuantity(item.key, item.quantity - 1)}
                            className="h-11 w-11 text-lg disabled:text-line-strong"
                          >
                            -
                          </button>
                          <span
                            aria-live="polite"
                            className="min-w-7 text-center font-mono text-sm"
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase quantity of ${item.product.name}`}
                            disabled={item.quantity >= MAX_QUANTITY}
                            onClick={() => setQuantity(item.key, item.quantity + 1)}
                            className="h-11 w-11 text-lg disabled:text-line-strong"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.key)}
                          aria-label={`Remove ${item.product.name} from cart`}
                          className="inline-flex min-h-11 items-center text-[0.8125rem] text-smoke underline underline-offset-4 hover:text-bone"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {suggestions.length > 0 ? (
                <div className="flex flex-col gap-3 py-5">
                  <h3 className="label text-xs text-smoke">You may also like</h3>
                  {suggestions.map((product) => {
                    const color = product.colors[0];
                    return (
                      <div key={product.slug} className="flex items-center gap-3.5">
                        <div className="flex h-[4.375rem] w-14 flex-none items-center justify-center bg-well p-1.5">
                          <TeeMockup
                            color={color.hex}
                            ink={color.ink}
                            graphic={product.graphic}
                            label=""
                            className="h-full w-full"
                          />
                        </div>
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
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-line px-6 pb-6 pt-5">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Subtotal</span>
                <span className="font-mono text-lg text-white">{formatMoney(subtotalCents)}</span>
              </div>
              <p className="text-[0.8125rem] text-smoke">
                Shipping and tax are calculated at checkout.
              </p>
              {/* Enabled when checkout is built. */}
              <button
                type="button"
                disabled
                className="btn btn-accent min-h-[3.625rem] w-full text-[1.0625rem] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Checkout
              </button>
              <p className="text-center text-[0.8125rem] text-smoke">Checkout is opening soon.</p>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
