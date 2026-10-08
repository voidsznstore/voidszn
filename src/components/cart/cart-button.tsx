"use client";

import { useCart } from "@/lib/cart-store";
import { useCartUi } from "./cart-provider";

export function CartButton() {
  const { count } = useCart();
  const { openCart } = useCartUi();

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={`Open cart, ${count} ${count === 1 ? "item" : "items"}`}
      className="inline-flex min-h-11 items-center gap-2 hover:text-white"
    >
      Cart
      <span
        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-xs ${
          count > 0 ? "bg-accent text-on-accent" : "border border-line-strong text-smoke"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
