import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderActionForm } from "@/components/admin/order-action-form";
import { Loading } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { type OrderDetail, getOrderDetail } from "@/db/queries/admin-orders";
import { formatDateTime, statusLabel } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";
import {
  addressAction,
  cancelAction,
  deliveredAction,
  inProductionAction,
  noteAction,
  resolveAction,
  shippedAction,
} from "../actions";

export const metadata: Metadata = { title: "Order" };

type Props = PageProps<"/admin/orders/[number]">;

export default function OrderPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Order params={params} />
    </Suspense>
  );
}

const panel = "flex flex-col gap-4 border border-line bg-ash-soft p-5";
const heading = "text-lg font-semibold text-white";
const small = "text-[0.8125rem] text-smoke";

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`field-${name}`} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={`field-${name}`}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        className="input"
      />
    </div>
  );
}

/** A ready-to-send email telling the customer their order shipped, opened in the owner's mail app. */
function trackingEmail({ order }: OrderDetail): string {
  const lines = [
    `Hi ${order.shippingName.split(" ")[0] || "there"},`,
    "",
    `Your VOIDSZN order ${order.orderNumber} is on its way.`,
    order.shippingCarrier ? `Carrier: ${order.shippingCarrier}` : null,
    order.trackingNumber ? `Tracking number: ${order.trackingNumber}` : null,
    order.trackingUrl ? `Track it here: ${order.trackingUrl}` : null,
    "",
    `Standard shipping takes ${siteConfig.shipping.transitDays} business days.`,
    "",
    "Thanks for your order.",
    siteConfig.name,
  ].filter((line) => line !== null);
  const query = new URLSearchParams({
    subject: `Your ${siteConfig.name} order ${order.orderNumber} has shipped`,
    body: lines.join("\n"),
  });
  // Mail apps expect %20 for spaces, not "+".
  return `mailto:${order.email}?${query.toString().replace(/\+/g, "%20")}`;
}

async function Order({ params }: Pick<Props, "params">) {
  await requireAdmin();
  const { number } = await params;
  const detail = /^VS-[A-Z0-9]{6,12}$/.test(number) ? await getOrderDetail(getDb(), number) : null;
  if (!detail) notFound();

  const { order, items, events, attention } = detail;
  const address = order.shippingAddress;
  const hasAddress = Boolean(address.line1);
  const open = order.status === "PAID" || order.status === "IN_PRODUCTION";
  const shipped = order.status === "SHIPPED" || order.status === "DELIVERED";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/admin/orders" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
          All orders
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="display text-4xl text-white">{order.orderNumber}</h1>
          <span className="label border border-line-strong px-3 py-1.5 text-xs">
            {statusLabel(order.status)}
          </span>
        </div>
        <p className="text-sm text-smoke">Placed {formatDateTime(order.createdAt)}</p>
      </header>

      {attention.length > 0 ? (
        <section className="flex flex-col gap-3 border border-accent p-5">
          <h2 className={heading}>Needs attention</h2>
          <ul className="list-disc pl-5 text-bone-dim">
            {attention.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <OrderActionForm
            action={resolveAction}
            orderNumber={order.orderNumber}
            submitLabel="Mark as dealt with"
          />
        </section>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Items */}
          <section className={panel}>
            <h2 className={heading}>Items</h2>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.id} className="flex gap-4 border-b border-line py-3 last:border-b-0">
                  <span className="relative block h-16 w-[3.25rem] flex-none overflow-hidden bg-well">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt="" fill sizes="3.25rem" className="object-cover" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {item.productName}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                    </p>
                    <p className="label text-xs text-smoke">
                      {item.colorName} / {item.size}
                    </p>
                    <p className="font-mono text-xs text-smoke">{item.sku}</p>
                  </div>
                  <span className="font-mono text-sm">
                    {formatMoney(item.unitPriceCents * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
              {[
                ["Subtotal", formatMoney(order.subtotalCents)],
                order.discountCents > 0 ? ["Discount", `-${formatMoney(order.discountCents)}`] : null,
                ["Shipping", formatMoney(order.shippingCents)],
                order.taxCents > 0 ? ["Tax", formatMoney(order.taxCents)] : null,
              ]
                .filter((row) => row !== null)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between text-bone-dim">
                    <dt>{label}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ))}
              <div className="flex justify-between pt-1 text-base font-semibold text-white">
                <dt>Total paid</dt>
                <dd className="font-mono">{formatMoney(order.totalCents)}</dd>
              </div>
            </dl>
          </section>

          {/* Fulfilment */}
          <section className={panel}>
            <h2 className={heading}>Fulfilment</h2>

            {order.status === "PAID" ? (
              <>
                <p className="text-bone-dim">
                  Place this order with the printer, then mark it so you know it&apos;s been sent.
                </p>
                <OrderActionForm
                  action={inProductionAction}
                  orderNumber={order.orderNumber}
                  submitLabel="Mark as sent to the printer"
                  tone="accent"
                />
              </>
            ) : null}

            {order.status === "IN_PRODUCTION" ? (
              <p className="text-bone-dim">
                Sent to the printer
                {order.fulfillmentSubmittedAt ? ` ${formatDateTime(order.fulfillmentSubmittedAt)}` : ""}.
                Add the tracking details when it ships.
              </p>
            ) : null}

            {shipped ? (
              <div className="flex flex-col gap-1 text-bone-dim">
                <p>
                  Shipped{order.shippedAt ? ` ${formatDateTime(order.shippedAt)}` : ""}
                  {order.shippingCarrier ? ` with ${order.shippingCarrier}` : ""}.
                </p>
                {order.trackingNumber ? (
                  <p>
                    Tracking:{" "}
                    {order.trackingUrl ? (
                      <a href={order.trackingUrl} rel="noreferrer" target="_blank" className="font-mono underline underline-offset-4">
                        {order.trackingNumber}
                      </a>
                    ) : (
                      <span className="font-mono">{order.trackingNumber}</span>
                    )}
                  </p>
                ) : null}
                {order.deliveredAt ? <p>Delivered {formatDateTime(order.deliveredAt)}.</p> : null}
                <p className="pt-2">
                  <a href={trackingEmail(detail)} className="btn btn-outline min-h-11 px-5">
                    Email tracking to the customer
                  </a>
                </p>
                <p className={small}>
                  The store doesn&apos;t send shipping emails by itself yet. This opens an email
                  in your mail app, already written, for you to send.
                </p>
              </div>
            ) : null}

            {open || order.status === "SHIPPED" ? (
              <details className="border-t border-line pt-3" open={order.status === "IN_PRODUCTION"}>
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
                  {order.status === "SHIPPED" ? "Change tracking details" : "Mark as shipped"}
                </summary>
                <div className="pt-2">
                  <OrderActionForm
                    action={shippedAction}
                    orderNumber={order.orderNumber}
                    submitLabel={order.status === "SHIPPED" ? "Save tracking" : "Mark as shipped"}
                    tone={order.status === "IN_PRODUCTION" ? "accent" : "outline"}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Carrier" name="carrier" defaultValue={order.shippingCarrier} placeholder="USPS" />
                      <Field label="Tracking number" name="trackingNumber" defaultValue={order.trackingNumber} />
                    </div>
                    <Field label="Tracking link (optional)" name="trackingUrl" defaultValue={order.trackingUrl} placeholder="https://" />
                  </OrderActionForm>
                </div>
              </details>
            ) : null}

            {order.status === "SHIPPED" ? (
              <OrderActionForm
                action={deliveredAction}
                orderNumber={order.orderNumber}
                submitLabel="Mark as delivered"
              />
            ) : null}

            {order.status === "CANCELLED" || order.status === "REFUNDED" ? (
              <p className="text-bone-dim">This order was cancelled. Nothing more to do.</p>
            ) : null}
          </section>

          {/* Notes and history */}
          <section className={panel}>
            <h2 className={heading}>Notes and history</h2>
            <OrderActionForm
              action={noteAction}
              orderNumber={order.orderNumber}
              submitLabel="Add note"
              resetOnDone
            >
              <label htmlFor="field-note" className="sr-only">
                Note
              </label>
              <textarea
                id="field-note"
                name="note"
                rows={2}
                maxLength={1000}
                placeholder="A note for yourself. Customers never see these."
                className="input"
              />
            </OrderActionForm>
            <ol className="flex flex-col border-t border-line">
              {events.map((event) => (
                <li key={event.id} className="flex flex-col gap-0.5 border-b border-line py-3 last:border-b-0">
                  <span className={event.type === "order.note" ? "text-bone" : "text-bone-dim"}>
                    {event.message ?? event.type}
                  </span>
                  <span className={small}>
                    {formatDateTime(event.createdAt)}
                    {event.actor !== "system" ? ` · ${event.actor}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          {/* Customer */}
          <section className={panel}>
            <h2 className={heading}>Customer</h2>
            <div className="flex flex-col gap-1 text-bone-dim">
              <a href={`mailto:${order.email}`} className="underline underline-offset-4">
                {order.email}
              </a>
            </div>
          </section>

          {/* Shipping address */}
          <section className={panel}>
            <h2 className={heading}>Ship to</h2>
            {hasAddress ? (
              <address className="not-italic text-bone-dim">
                {order.shippingName}
                <br />
                {address.line1}
                {address.line2 ? (
                  <>
                    <br />
                    {address.line2}
                  </>
                ) : null}
                <br />
                {address.city}, {address.state} {address.postalCode}
                <br />
                {address.country}
              </address>
            ) : (
              <p className="text-accent">No address on this order. Add it before fulfilling.</p>
            )}
            {open ? (
              <details open={!hasAddress}>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
                  {hasAddress ? "Change address" : "Add address"}
                </summary>
                <div className="pt-2">
                  <OrderActionForm action={addressAction} orderNumber={order.orderNumber} submitLabel="Save address">
                    <Field label="Name" name="name" defaultValue={order.shippingName} required />
                    <Field label="Street address" name="line1" defaultValue={address.line1} required />
                    <Field label="Apartment, suite (optional)" name="line2" defaultValue={address.line2} />
                    <Field label="City" name="city" defaultValue={address.city} required />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="State" name="state" defaultValue={address.state} required />
                      <Field label="ZIP code" name="postalCode" defaultValue={address.postalCode} required />
                    </div>
                    <Field label="Country code" name="country" defaultValue={address.country || "US"} required />
                  </OrderActionForm>
                </div>
              </details>
            ) : null}
          </section>

          {/* Payment */}
          <section className={panel}>
            <h2 className={heading}>Payment</h2>
            <dl className="flex flex-col gap-2 text-sm text-bone-dim">
              <div>
                <dt className={small}>Paid</dt>
                <dd>{order.paidAt ? formatDateTime(order.paidAt) : "Not paid"}</dd>
              </div>
              <div>
                <dt className={small}>Through</dt>
                <dd className="capitalize">{order.paymentProvider ?? "Unknown"}</dd>
              </div>
              <div>
                <dt className={small}>Payment reference</dt>
                <dd className="break-all font-mono text-xs">{order.paymentRef ?? "None"}</dd>
              </div>
            </dl>
          </section>

          {open ? (
            <section className={panel}>
              <h2 className={heading}>Cancel order</h2>
              <p className={small}>
                Cancelling here does not give the money back. Refund the payment in Square first
                (find it by the payment reference above), then cancel it here.
              </p>
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
                  Cancel this order
                </summary>
                <div className="pt-2">
                  <OrderActionForm
                    action={cancelAction}
                    orderNumber={order.orderNumber}
                    submitLabel="Cancel order"
                    pendingLabel="Cancelling…"
                  >
                    <Field label="Reason (optional)" name="reason" placeholder="Customer asked within the hour" />
                  </OrderActionForm>
                </div>
              </details>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
