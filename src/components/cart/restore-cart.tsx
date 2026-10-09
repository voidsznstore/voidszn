"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type CartLine, replaceCart, setDiscountCode } from "@/lib/cart-store";

type Outcome = "working" | "ordered" | "gone";

/** Refills the cart from a reminder email's link, applies its code, and goes to checkout. */
export function RestoreCart({ token, code }: { token: string; code: string | null }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>("working");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/cart/restore/${encodeURIComponent(token)}`);
        const data = (await response.json().catch(() => null)) as
          | { lines?: CartLine[]; ordered?: boolean }
          | null;
        if (cancelled) return;
        if (data?.ordered) return setOutcome("ordered");
        if (!response.ok || !data?.lines?.length) return setOutcome("gone");
        replaceCart(data.lines);
        if (code) setDiscountCode(code);
        router.replace("/checkout");
      } catch {
        if (!cancelled) setOutcome("gone");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, code, router]);

  if (outcome === "working") {
    return (
      <p aria-live="polite" className="text-bone-dim">
        Getting your cart…
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <h1 className="display text-5xl text-white">
        {outcome === "ordered" ? "Already ordered" : "Cart not found"}
      </h1>
      <p className="max-w-md text-balance text-bone-dim">
        {outcome === "ordered"
          ? "This cart has already been turned into an order. Thank you."
          : "This link has run out. Your picks are still in the store."}
      </p>
      <Link href="/collections/all" className="btn btn-accent">
        Shop all
      </Link>
    </div>
  );
}
