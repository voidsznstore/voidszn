"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCart } from "@/lib/cart-store";

type Checkout =
  | { state: "loading" }
  | { state: "ready"; signature: string; url: string }
  | { state: "error"; signature: string; message: string };

const noop = () => () => {};

/** False on the server and the first client render, true once the saved cart can be read. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

const FALLBACK_ERROR = "Checkout could not be started. Please try again.";

/**
 * Sends the cart to the server, which prices it and opens a payment page for
 * exactly that order, then takes the customer there.
 */
export function CheckoutForm() {
  const hydrated = useHydrated();
  const { lines: cart } = useCart();
  const [checkout, setCheckout] = useState<Checkout>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Changes whenever the cart does, so the payment page always matches the cart.
  const signature = JSON.stringify(
    cart.map((line) => [line.slug, line.color, line.size, line.quantity]),
  );
  const isEmpty = cart.length === 0;

  useEffect(() => {
    if (!hydrated || isEmpty) return;

    const controller = new AbortController();
    const lines = (JSON.parse(signature) as [string, string, string, number][]).map(
      ([slug, color, size, quantity]) => ({ slug, color, size, quantity }),
    );

    (async () => {
      try {
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as {
          url?: string;
          error?: string;
        } | null;
        if (!response.ok || !data?.url) throw new Error(data?.error ?? FALLBACK_ERROR);
        setCheckout({ state: "ready", signature, url: data.url });
        window.location.assign(data.url);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCheckout({
          state: "error",
          signature,
          message: error instanceof Error && error.message ? error.message : FALLBACK_ERROR,
        });
      }
    })();

    return () => controller.abort();
  }, [hydrated, isEmpty, signature, attempt]);

  if (!hydrated) return <Notice>Loading checkout…</Notice>;

  if (isEmpty) {
    return (
      <Notice>
        <span>Your cart is empty.</span>
        <Link href="/collections/all" className="btn btn-accent">
          Shop all
        </Link>
      </Notice>
    );
  }

  // A payment page made for an earlier version of the cart is never shown.
  const current =
    checkout.state !== "loading" && checkout.signature === signature ? checkout : null;

  if (current?.state === "error") {
    return (
      <Notice>
        <span role="alert">{current.message}</span>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setCheckout({ state: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </Notice>
    );
  }

  return (
    <Notice>
      <span>Taking you to secure checkout…</span>
      {current?.state === "ready" ? (
        // Shown if the browser didn't move on by itself, or the customer came back.
        <a href={current.url} className="btn btn-accent">
          Continue to payment
        </a>
      ) : null}
    </Notice>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="flex min-h-[20rem] flex-col items-center justify-center gap-5 border border-line px-6 text-center text-bone-dim"
    >
      {children}
    </div>
  );
}
