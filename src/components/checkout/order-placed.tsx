"use client";

import { useEffect } from "react";
import { clearCart } from "@/lib/cart-store";

/** Runs on the confirmation page once payment has gone through, and empties the cart. */
export function OrderPlaced() {
  useEffect(() => {
    clearCart();
  }, []);

  return null;
}
