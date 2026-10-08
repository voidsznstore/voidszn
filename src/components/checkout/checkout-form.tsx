"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCart } from "@/lib/cart-store";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
// Loaded once, and only on the checkout page.
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

type Session =
  | { state: "loading" }
  | { state: "ready"; signature: string; clientSecret: string }
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

export function CheckoutForm() {
  const hydrated = useHydrated();
  const { items } = useCart();
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Changes whenever the cart does, so the payment form always matches the cart.
  const signature = JSON.stringify(
    items.map((item) => [item.slug, item.color, item.size, item.quantity]),
  );
  const isEmpty = items.length === 0;

  useEffect(() => {
    if (!hydrated || isEmpty || !stripePromise) return;

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
          clientSecret?: string;
          error?: string;
        } | null;
        if (!response.ok || !data?.clientSecret) {
          throw new Error(data?.error ?? "Checkout could not be started. Please try again.");
        }
        setSession({ state: "ready", signature, clientSecret: data.clientSecret });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSession({
          state: "error",
          signature,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Checkout could not be started. Please try again.",
        });
      }
    })();

    return () => controller.abort();
  }, [hydrated, isEmpty, signature, attempt]);

  if (!stripePromise) {
    return <Notice>Checkout is opening soon.</Notice>;
  }

  if (!hydrated) {
    return <Notice>Loading checkout…</Notice>;
  }

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

  // A session made for an earlier version of the cart is never shown.
  const current = session.state !== "loading" && session.signature === signature ? session : null;

  if (current?.state === "error") {
    return (
      <Notice>
        <span role="alert">{current.message}</span>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setSession({ state: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </Notice>
    );
  }

  if (current?.state !== "ready") {
    return <Notice>Loading checkout…</Notice>;
  }

  return (
    // The payment form is drawn by Stripe on a light background.
    <div className="bg-white py-6">
      <EmbeddedCheckoutProvider
        key={current.clientSecret}
        stripe={stripePromise}
        options={{ clientSecret: current.clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
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
