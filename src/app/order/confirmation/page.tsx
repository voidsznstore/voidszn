import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OrderPlaced } from "@/components/checkout/order-placed";
import { Email } from "@/components/site/info-page";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getDb } from "@/db";
import { findOrderNumberByPaymentRef } from "@/db/queries/orders";
import { getProductBySlug } from "@/lib/catalog";
import { decodeCart } from "@/lib/checkout/pricing";
import { formatMoney } from "@/lib/money";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";
import { paymentRefFor } from "@/lib/payments/stripe-orders";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Order confirmation",
  robots: { index: false, follow: false },
};

export default function ConfirmationPage({ searchParams }: PageProps<"/order/confirmation">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-12 sm:px-10">
        <Suspense fallback={<p className="text-bone-dim">Loading your order…</p>}>
          <Confirmation searchParams={searchParams} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

async function Confirmation({
  searchParams,
}: Pick<PageProps<"/order/confirmation">, "searchParams">) {
  const { session_id: sessionId } = await searchParams;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId) || !isStripeConfigured()) {
    return <NotFound />;
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return <NotFound />;
  }

  // Still unpaid: send them back to finish.
  if (session.status === "open") redirect("/checkout");
  if (session.status !== "complete") return <NotFound />;

  // The order itself is written when the payment processor confirms payment, which
  // can land a moment after the customer does.
  let orderNumber: string | null = null;
  try {
    orderNumber = await findOrderNumberByPaymentRef(getDb(), paymentRefFor(session));
  } catch (error) {
    console.error("[confirmation] Could not look up the order", error);
  }

  const paid = session.payment_status !== "unpaid";
  const email = session.customer_details?.email;
  const lines = decodeCart(session.metadata) ?? [];
  const { shipping, orders, supportEmail } = siteConfig;
  const details = session.total_details;

  return (
    <>
      <OrderPlaced hasOrderNumber={Boolean(orderNumber) || !paid} />

      <header className="flex flex-col gap-4 border-b border-line pb-8">
        <p className="label text-xs text-accent">{paid ? "Order placed" : "Payment pending"}</p>
        <h1 className="display text-[clamp(2.75rem,7vw,4.5rem)] text-white">
          {paid ? "Thank you" : "Almost there"}
        </h1>
        <p className="text-lg text-bone-dim">
          {paid
            ? `Your order is in.${email ? ` Updates go to ${email}.` : ""}`
            : "Your bank is still confirming the payment. We'll start on your order as soon as it clears."}
        </p>
        {orderNumber ? (
          <p className="label text-sm text-bone">
            Order number <span className="font-mono text-white">{orderNumber}</span>
          </p>
        ) : null}
      </header>

      {lines.length > 0 ? (
        <section aria-label="Order summary" className="border-b border-line py-8">
          <ul className="flex flex-col gap-4">
            {lines.map((line) => (
              <li
                key={`${line.slug}:${line.color}:${line.size}`}
                className="flex justify-between gap-4"
              >
                <div>
                  <p className="font-semibold">
                    {getProductBySlug(line.slug)?.name ?? line.slug}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                  </p>
                  <p className="label text-xs text-smoke">
                    {line.color} / {line.size}
                  </p>
                </div>
                <span className="font-mono text-sm">
                  {formatMoney(line.unitPriceCents * line.quantity)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-6 flex flex-col gap-2 border-t border-line pt-6 text-sm">
            {details?.amount_discount ? (
              <Row label="Discount" value={`-${formatMoney(details.amount_discount)}`} />
            ) : null}
            <Row label="Shipping" value={formatMoney(details?.amount_shipping ?? 0)} />
            <Row label="Tax" value={formatMoney(details?.amount_tax ?? 0)} />
            <div className="flex justify-between pt-2 text-base font-semibold text-white">
              <dt>Total</dt>
              <dd className="font-mono">{formatMoney(session.amount_total ?? 0)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="prose-site pt-8">
        <h2>What happens next</h2>
        <p>
          Every item is printed to order. Printing and packing takes {shipping.productionDays}{" "}
          business days, then standard shipping takes {shipping.transitDays} business days. We
          email tracking when it ships.
        </p>
        <p>
          Need to change or cancel? Email <Email address={supportEmail} /> within{" "}
          {orders.cancelWindow} of ordering{orderNumber ? ` and include ${orderNumber}` : ""}.
        </p>
        <p>
          <Link href="/collections/all">Keep shopping</Link>
        </p>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-bone-dim">
      <dt>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-5">
      <h1 className="display text-[clamp(2.5rem,6vw,4rem)] text-white">Order not found</h1>
      <p className="text-bone-dim">
        We couldn&apos;t find that order. If you paid and expected to see a confirmation, write to{" "}
        <Email address={siteConfig.supportEmail} /> and we&apos;ll sort it out.
      </p>
      <Link href="/collections/all" className="btn btn-accent">
        Shop all
      </Link>
    </div>
  );
}
