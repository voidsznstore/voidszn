"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { CartThumb } from "@/components/cart/cart-drawer";
import { useCartView } from "@/components/cart/use-cart-view";
import { setDiscountCode, useCart, useDiscountCode } from "@/lib/cart-store";
import type { CheckoutQuote } from "@/lib/checkout/request";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";

const noop = () => () => {};

/** False on the server and the first client render, true once the saved cart can be read. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

const EMAIL_KEY = "voidszn-email-v1";
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

function savedEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The step before paying: what's in the order, a place for a discount code, and
 * the email the receipt goes to. The server works out every number shown here,
 * and works them out again when the payment page is opened.
 */
export function CheckoutForm() {
  // Every fresh visit to checkout starts clean, rather than showing an earlier visit.
  const { bfcacheId } = useRouter();
  const hydrated = useHydrated();
  if (!hydrated) return <Notice>Loading checkout…</Notice>;
  return <Checkout key={bfcacheId} />;
}

type Quoted =
  | { state: "loading" }
  | { state: "ready"; signature: string; quote: CheckoutQuote }
  | { state: "error"; signature: string; message: string };

function Checkout() {
  const { lines: cart } = useCart();
  const code = useDiscountCode();
  const emailId = useId();
  const codeId = useId();

  const [email, setEmail] = useState(savedEmail);
  // The email the totals were last worked out for. Only moves when the field is left.
  const [quotedEmail, setQuotedEmail] = useState(() =>
    looksLikeEmail(savedEmail()) ? savedEmail().trim().toLowerCase() : "",
  );
  // Why the last code tried didn't apply. Stays up until another is tried.
  const [codeNote, setCodeNote] = useState<string | null>(null);
  const [marketing, setMarketing] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [quoted, setQuoted] = useState<Quoted>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [paying, setPaying] = useState<{ state: "idle" | "going" } | { state: "error"; message: string }>({
    state: "idle",
  });

  const keys = JSON.stringify(cart.map((line) => [line.slug, line.color, line.size]));
  const view = useCartView(keys, true);
  const art = new Map(view?.items.map((item) => [item.key, item]));

  // Changes whenever the cart or the code does, so the totals always match. The
  // email only matters when there is a code, which may be one per customer.
  const signature = JSON.stringify([
    cart.map((line) => [line.slug, line.color, line.size, line.quantity]),
    code,
    code ? quotedEmail : "",
  ]);
  const isEmpty = cart.length === 0;

  useEffect(() => {
    if (isEmpty) return;
    const controller = new AbortController();
    const [lines, usedCode, usedEmail] = JSON.parse(signature) as [
      [string, string, string, number][],
      string | null,
      string,
    ];

    (async () => {
      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: lines.map(([slug, color, size, quantity]) => ({ slug, color, size, quantity })),
            ...(usedCode ? { code: usedCode } : {}),
            ...(usedEmail ? { email: usedEmail } : {}),
          }),
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as
          | (CheckoutQuote & { error?: string })
          | null;
        if (!response.ok || !data || data.error) {
          throw new Error(data?.error ?? "The order could not be priced. Please try again.");
        }
        setQuoted({ state: "ready", signature, quote: data });
        if (usedCode && data.codeError) {
          // The reason stays on screen. A code that is fine but needs a bigger
          // order is kept for when the cart grows. Any other is dropped.
          setCodeNote(data.codeError);
          if (!data.codeCanApplyLater) setDiscountCode(null);
        } else if (usedCode) {
          // Only a code that went through clears the note. Dropping a refused code
          // prices the cart again without one, and that must not wipe the reason.
          setCodeNote(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setQuoted({
          state: "error",
          signature,
          message:
            error instanceof Error && error.message
              ? error.message
              : "The order could not be priced. Please try again.",
        });
      }
    })();

    return () => controller.abort();
  }, [isEmpty, signature, attempt]);

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

  // Totals worked out for an earlier version of the cart are never shown as current.
  const current = quoted.state !== "loading" && quoted.signature === signature ? quoted : null;
  const quote = current?.state === "ready" ? current.quote : null;
  // While new totals load, the last ones stay on screen, dimmed.
  const shown = quote ?? (quoted.state === "ready" ? quoted.quote : null);
  const isStale = shown !== null && quote === null;

  if (current?.state === "error" && !shown) {
    return (
      <Notice>
        <span role="alert">{current.message}</span>
        <button type="button" className="btn btn-glass" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </Notice>
    );
  }

  function applyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!codeDraft.trim()) return;
    setCodeNote(null);
    setDiscountCode(codeDraft);
    setCodeDraft("");
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!looksLikeEmail(address)) {
      setPaying({ state: "error", message: "Enter your email address to continue." });
      document.getElementById(emailId)?.focus();
      return;
    }
    setPaying({ state: "going" });
    // If the server turns the code down for this address, the totals are worked
    // out again for it and say why.
    setQuotedEmail(address.toLowerCase());
    try {
      window.localStorage.setItem(EMAIL_KEY, address);
    } catch {
      // Not being able to remember the email is fine.
    }
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: cart.map(({ slug, color, size, quantity }) => ({ slug, color, size, quantity })),
          // The saved code goes with the order even if the totals on screen are
          // still catching up: the server checks it and refuses to carry on without
          // it, so nobody is charged full price for a discounted total. It is only
          // left off when the totals on screen already say it doesn't apply.
          ...(code && !(quote && quote.codeError) ? { code } : {}),
          email: address,
          marketing,
        }),
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) {
        throw new Error(data?.error ?? "Checkout could not be started. Please try again.");
      }
      window.location.assign(data.url);
    } catch (error) {
      setPaying({
        state: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Checkout could not be started. Please try again.",
      });
      // The totals may have changed underneath (a price, a code running out).
      setAttempt((value) => value + 1);
    }
  }

  const going = paying.state === "going";

  return (
    <div className="mx-auto grid max-w-5xl items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* The order */}
      <section aria-label="Your order" className="panel px-5 py-6 sm:px-7">
        <h2 className="mb-4 text-lg font-semibold text-white">Your order</h2>
        <ul>
          {cart.map((line) => {
            const key = `${line.slug}:${line.color}:${line.size}`;
            const item = art.get(key);
            const priced = shown?.lines.find((candidate) => candidate.key === key);
            return (
              <li key={key} className="flex items-center gap-4 border-b border-line py-4 first:pt-0">
                {item ? (
                  <CartThumb art={item} className="h-20 w-16" />
                ) : (
                  <span className="well block h-20 w-16 flex-none !rounded-field" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{priced?.name ?? item?.name ?? "Loading…"}</p>
                  <p className="text-sm text-smoke">
                    {line.color}, {line.size}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                  </p>
                </div>
                <span className="num flex-none text-[0.9375rem] font-semibold text-white">
                  {priced ? formatMoney(priced.lineCents) : ""}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Discount code */}
        <div className="border-b border-line py-5">
          {shown?.discount ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="tag tag-warn">{shown.discount.code}</span>
              <span className="text-bone-dim">{shown.discount.label} applied.</span>
              <button
                type="button"
                onClick={() => setDiscountCode(null)}
                className="link inline-flex min-h-11 items-center text-smoke"
              >
                Remove
              </button>
            </p>
          ) : (
            <form onSubmit={applyCode} className="flex flex-col gap-2">
              <label htmlFor={codeId} className="text-sm font-semibold">
                Discount code
              </label>
              <div className="flex gap-2">
                <input
                  id={codeId}
                  value={codeDraft}
                  onChange={(event) => setCodeDraft(event.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={30}
                  className="input min-w-0 flex-1 font-mono uppercase tracking-wider"
                />
                <button type="submit" className="btn btn-glass btn-sm min-h-[2.875rem] flex-none px-6">
                  Apply
                </button>
              </div>
              <p role="alert" aria-live="polite" className="min-h-5 text-sm text-ember">
                {codeNote ?? ""}
              </p>
            </form>
          )}
        </div>

        <dl
          aria-busy={isStale || !shown}
          className={`flex flex-col gap-2 pt-5 text-[0.9375rem] transition-opacity ${isStale ? "opacity-50" : ""}`}
        >
          <Row label="Subtotal" value={shown ? formatMoney(shown.subtotalCents) : "…"} />
          {shown && shown.discountCents > 0 ? (
            <Row
              label={`Discount${shown.discount ? ` (${shown.discount.code})` : ""}`}
              value={`−${formatMoney(shown.discountCents)}`}
              accent
            />
          ) : null}
          {shown?.discount?.freeShipping ? (
            <div className="flex justify-between gap-4 text-bone-dim">
              <dt>Shipping ({shown.discount.code})</dt>
              <dd className="num">
                <s className="mr-2 text-smoke">{formatMoney(shown.shippingBeforeCents)}</s>
                <span className="font-semibold text-ember">Free</span>
              </dd>
            </div>
          ) : (
            <Row label="Standard shipping" value={shown ? formatMoney(shown.shippingCents) : "…"} />
          )}
          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-white">
            <dt className="text-base font-semibold">Total</dt>
            <dd className="num text-2xl font-semibold">{shown ? formatMoney(shown.totalCents) : "…"}</dd>
          </div>
        </dl>
      </section>

      {/* Who it's for, and on to payment */}
      <form onSubmit={pay} noValidate className="panel flex flex-col gap-5 px-5 py-6 sm:px-7 lg:sticky lg:top-28">
        <div className="flex flex-col gap-2">
          <label htmlFor={emailId} className="text-lg font-semibold text-white">
            Your email
          </label>
          <input
            id={emailId}
            type="email"
            name="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (paying.state === "error") setPaying({ state: "idle" });
            }}
            onBlur={() => setQuotedEmail(looksLikeEmail(email) ? email.trim().toLowerCase() : "")}
            autoComplete="email"
            inputMode="email"
            required
            placeholder="you@example.com"
            className="input min-h-[3.25rem]"
          />
          <p className="text-[0.8125rem] text-smoke">
            Your receipt and tracking go here.
            {shown?.cartReminders
              ? " If you leave before paying, we'll email a reminder with your cart saved."
              : ""}
          </p>
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-bone-dim">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
            className="mt-0.5 h-5 w-5 flex-none accent-[var(--color-accent)]"
          />
          Email me new designs and offers. Unsubscribe any time.
        </label>

        <div className="flex flex-col gap-3">
          <button
            type="submit"
            disabled={going || !shown}
            className="btn btn-accent min-h-14 w-full text-[1.0625rem]"
          >
            {going ? "Opening secure payment…" : "Continue to payment"}
          </button>
          <p role="alert" aria-live="assertive" className="min-h-5 text-center text-sm text-ember">
            {paying.state === "error" ? paying.message : ""}
          </p>
        </div>

        <p className="border-t border-line pt-4 text-[0.8125rem] text-smoke">
          Next you&apos;ll add your shipping address and pay on Square&apos;s secure page. Every item
          is printed to order. If it arrives damaged or wrong, we replace or refund it within{" "}
          {siteConfig.orders.issueWindowDays} days.{" "}
          <Link href="/returns" className="link">
            Returns policy
          </Link>
        </p>
      </form>
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-bone-dim">
      <dt>{label}</dt>
      <dd className={`num ${accent ? "font-semibold text-ember" : ""}`}>{value}</dd>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="panel mx-auto flex min-h-[20rem] max-w-xl flex-col items-center justify-center gap-5 px-6 text-center text-bone-dim"
    >
      {children}
    </div>
  );
}
