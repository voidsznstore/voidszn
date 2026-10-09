"use client";

import { useEffect } from "react";
import { clearCart, setDiscountCode } from "@/lib/cart-store";

/** Runs on the confirmation page once payment has gone through, and empties the cart and its code. */
export function OrderPlaced() {
  useEffect(() => {
    clearCart();
    // The code has been used. Left in place it would quietly apply to the next order.
    setDiscountCode(null);
  }, []);

  return null;
}
