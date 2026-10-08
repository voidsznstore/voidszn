"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { clearCart } from "@/lib/cart-store";

const REFRESH_EVERY_MS = 2500;
const MAX_REFRESHES = 6;

/**
 * Runs on the confirmation page once payment has gone through. Empties the cart,
 * and while the order number has not arrived yet, checks again a few times.
 */
export function OrderPlaced({ hasOrderNumber }: { hasOrderNumber: boolean }) {
  const router = useRouter();

  useEffect(() => {
    clearCart();
  }, []);

  useEffect(() => {
    if (hasOrderNumber) return;
    let refreshes = 0;
    const timer = window.setInterval(() => {
      refreshes += 1;
      router.refresh();
      if (refreshes >= MAX_REFRESHES) window.clearInterval(timer);
    }, REFRESH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [hasOrderNumber, router]);

  return null;
}
