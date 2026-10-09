import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrderPlaced } from "@/components/checkout/order-placed";
import { Email } from "@/components/site/info-page";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { ORDER_COOKIE } from "@/lib/checkout/return";
import { formatMoney } from "@/lib/money";
import {
  ORDER_SOURCE,
  getOrder,
  isSquareConfigured,
  isSquareId,
} from "@/lib/payments/square";
import { type Settled, settlePayment } from "@/lib/payments/square-orders";
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

/** Looks up the order this browser just paid for and makes sure it is saved. */
async function findSettledOrder(orderId: string): Promise<Settled | { status: "unknown" }> {
  const order = await getOrder(orderId);
  if (!order || order.metadata?.source !== ORDER_SOURCE) return { status: "unknown" };

  const tender = order.tenders?.[0];
  const paymentId = tender?.payment_id ?? tender?.id;
  if (!isSquareId(paymentId)) return { status: "not_paid" };

  return settlePayment(paymentId, {
    provider: "square",
    id: `return:${paymentId}`,
    type: "checkout.return",
  });
}

async function Confirmation({
  searchParams,
}: Pick<PageProps<"/order/confirmation">, "searchParams">) {
  // Square adds the order id to the address when it sends the customer back. The
  // cookie set when checkout started covers the case where it doesn't.
  const params = await searchParams;
  const fromAddress = params.orderId ?? params.order_id;
  const fromCookie = (await cookies()).get(ORDER_COOKIE)?.value;
  const orderId = [fromAddress, fromCookie].find(isSquareId);

  if (!orderId || !isSquareConfigured()) return <NotFound />;

  // Confirming the order talks to Square and can save the order, so it must only
  // happen for a real visit, never while the framework renders ahead of time.
  await connection();

  let settled: Settled | { status: "unknown" };
  try {
    settled = await findSettledOrder(orderId);
  } catch (error) {
    console.error("[confirmation] Could not confirm the order", error);
    return <Unconfirmed />;
  }

  if (settled.status === "not_paid") return <NotPaid />;
  if (settled.status === "unreadable") return <Unconfirmed />;
  if (settled.status !== "saved") return <NotFound />;

  const { order, orderNumber, receiptUrl } = settled;
  const { shipping, orders, supportEmail } = siteConfig;

  return (
    <>
      <OrderPlaced />

      <header className="flex flex-col gap-4 border-b border-line pb-8">
        <p className="label text-xs text-accent">Order placed</p>
        <h1 className="display text-[clamp(2.75rem,7vw,4.5rem)] text-white">Thank you</h1>
        <p className="text-lg text-bone-dim">Your order is in. Updates go to {order.email}.</p>
        {orderNumber ? (
          <p className="label text-sm text-bone">
            Order number <span className="font-mono text-white">{orderNumber}</span>
          </p>
        ) : null}
      </header>

      <section aria-label="Order summary" className="border-b border-line py-8">
        <ul className="flex flex-col gap-4">
          {order.items.map((item) => (
            <li
              key={`${item.slug}:${item.colorName}:${item.size}`}
              className="flex justify-between gap-4"
            >
              <div>
                <p className="font-semibold">
                  {item.productName}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                </p>
                <p className="label text-xs text-smoke">
                  {item.colorName} / {item.size}
                </p>
              </div>
              <span className="font-mono text-sm">
                {formatMoney(item.unitPriceCents * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-6 flex flex-col gap-2 border-t border-line pt-6 text-sm">
          {order.discountCents > 0 ? (
            <Row label="Discount" value={`-${formatMoney(order.discountCents)}`} />
          ) : null}
          <Row label="Shipping" value={formatMoney(order.shippingCents)} />
          {order.taxCents > 0 ? <Row label="Tax" value={formatMoney(order.taxCents)} /> : null}
          <div className="flex justify-between pt-2 text-base font-semibold text-white">
            <dt>Total</dt>
            <dd className="font-mono">{formatMoney(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

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
          {receiptUrl ? (
            <>
              <a href={receiptUrl} rel="noreferrer">
                View your receipt
              </a>{" "}
              or{" "}
            </>
          ) : null}
          <Link href="/collections/all">{receiptUrl ? "keep shopping" : "Keep shopping"}</Link>
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

function Message({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-start gap-5">
      <h1 className="display text-[clamp(2.5rem,6vw,4rem)] text-white">{title}</h1>
      <p className="text-bone-dim">{children}</p>
      <Link href={action.href} className="btn btn-accent">
        {action.label}
      </Link>
    </div>
  );
}

function NotFound() {
  return (
    <Message title="Order not found" action={{ href: "/collections/all", label: "Shop all" }}>
      We couldn&apos;t find that order. If you paid and expected to see a confirmation, write to{" "}
      <Email address={siteConfig.supportEmail} /> and we&apos;ll sort it out.
    </Message>
  );
}

function NotPaid() {
  return (
    <Message title="Payment not finished" action={{ href: "/checkout", label: "Back to checkout" }}>
      That order hasn&apos;t been paid, so nothing was charged. Your cart is still saved.
    </Message>
  );
}

function Unconfirmed() {
  return (
    <Message title="Checking on your order" action={{ href: "/", label: "Back to the store" }}>
      We couldn&apos;t confirm your order just now. If you paid, your order will still reach
      us. Refresh this page in a minute, or write to <Email address={siteConfig.supportEmail} />.
    </Message>
  );
}
