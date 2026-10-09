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
      className="inline-flex h-11 items-center gap-2.5 rounded-full pl-4 pr-2 text-sm font-semibold text-bone transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      Cart
      <span
        className={`num inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold ${
          count > 0
            ? "bg-accent text-on-accent shadow-[0_0_18px_-2px_var(--glow)]"
            : "border border-line-strong text-smoke"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
