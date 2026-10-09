"use client";

import { useEffect, useState } from "react";
import { removeUnavailable } from "@/lib/cart-store";
import type { CartView } from "@/lib/cart-view";

/**
 * Asks the server what to show for the lines in the cart: names, prices and
 * pictures. Only runs while the cart is open, and only when the set of products
 * in it changes; quantity changes don't need a new answer.
 */
export function useCartView(keys: string, isOpen: boolean): CartView | null {
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
