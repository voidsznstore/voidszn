import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderActionForm } from "@/components/admin/order-action-form";
import { Loading } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { PAYMENT_METHODS, PICKUP } from "@/db/queries/admin-manual-orders";
import { type OrderDetail, getOrderDetail } from "@/db/queries/admin-orders";
import { formatDateTime, statusLabel } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { isEmailConfigured } from "@/lib/email/send";
import { isInboxConfigured } from "@/lib/mail/gmail";
import { optionLabel } from "@/lib/email/templates";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";
import {
  addressAction,
  cancelAction,
  deliveredAction,
  inProductionAction,
  noteAction,
  paidAction,
  refundAction,
  resendConfirmationAction,
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

const panel = "flex flex-col gap-4 panel p-5";
const heading = "text-lg font-semibold text-white";
const small = "text-[0.8125rem] text-smoke";

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  id = `field-${name}`,
}: {
  label: string;
  name: string;
  /** Only needed when two forms on the page have a field with the same name. */
  id?: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
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
  const unpaid = order.status === "PENDING";
  const isPickup = order.shippingMethod === PICKUP && !hasAddress;
  // Still being worked on: the address can change and the order can be cancelled.
  const open = unpaid || order.status === "PAID" || order.status === "IN_PRODUCTION";
  const canShip = order.status === "PAID" || order.status === "IN_PRODUCTION";
  const viaSquare = order.paymentProvider === "square";
  const shipped = order.status === "SHIPPED" || order.status === "DELIVERED";
  const emailsOn = isEmailConfigured();
  const refundable = order.totalCents - order.refundedCents;
  const canRefund = order.paymentProvider === "square" && Boolean(order.paymentRef) && refundable > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/admin/orders" className="text-sm text-smoke link">
          All orders
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="display text-4xl text-white">{order.orderNumber}</h1>
          <span className="tag">
            {statusLabel(order.status)}
          </span>
        </div>
        <p className="text-sm text-smoke">Placed {formatDateTime(order.createdAt)}</p>
      </header>

      {attention.length > 0 ? (
        <section className="flex flex-col gap-3 notice p-5">
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
                  <span className="relative block h-16 w-[3.25rem] flex-none well overflow-hidden !rounded-[0.5rem]">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt="" fill sizes="3.25rem" className="object-cover" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {item.productName}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                    </p>
                    {optionLabel(item) ? (
                      <p className="label text-smoke">{optionLabel(item)}</p>
                    ) : null}
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
                order.discountCents > 0
                  ? [
                      `Discount${order.discountCodeText ? ` (${order.discountCodeText})` : ""}`,
                      `-${formatMoney(order.discountCents)}`,
                    ]
                  : null,
                isPickup && order.shippingCents === 0
                  ? null
                  : [
                      // A free shipping code takes nothing off the items, so it shows here.
                      order.shippingCents === 0 && order.discountCents === 0 && order.discountCodeText
                        ? `Shipping (${order.discountCodeText})`
                        : "Shipping",
                      formatMoney(order.shippingCents),
                    ],
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
                <dt>{unpaid ? "Total due" : order.paidAt ? "Total paid" : "Total"}</dt>
                <dd className="font-mono">{formatMoney(order.totalCents)}</dd>
              </div>
              {order.refundedCents > 0 ? (
                <div className="flex justify-between text-ember">
                  <dt>Refunded</dt>
                  <dd className="font-mono">-{formatMoney(order.refundedCents)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Fulfilment */}
          <section className={panel}>
            <h2 className={heading}>Fulfilment</h2>

            {unpaid ? (
              <>
                <p className="text-bone-dim">
                  Waiting for payment of {formatMoney(order.totalCents)}. Mark it as paid when the
                  money arrives, then it moves to your to-fulfil list.
                </p>
                <OrderActionForm
                  action={paidAction}
                  orderNumber={order.orderNumber}
                  submitLabel="Mark as paid"
                  tone="accent"
                >
                  <div className="flex max-w-xs flex-col gap-1.5">
                    <label htmlFor="field-method" className="text-sm font-semibold">
                      Paid with
                    </label>
                    <select id="field-method" name="method" defaultValue="" required className="input">
                      <option value="" disabled>
                        Choose
                      </option>
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </div>
                </OrderActionForm>
              </>
            ) : null}

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
                      <a href={order.trackingUrl} rel="noreferrer" target="_blank" className="font-mono link">
                        {order.trackingNumber}
                      </a>
                    ) : (
                      <span className="font-mono">{order.trackingNumber}</span>
                    )}
                  </p>
                ) : null}
                {order.deliveredAt ? <p>Delivered {formatDateTime(order.deliveredAt)}.</p> : null}
                {emailsOn ? null : (
                  <>
                    <p className="pt-2">
                      <a href={trackingEmail(detail)} className="btn btn-glass min-h-11 px-5">
                        Email tracking to the customer
                      </a>
                    </p>
                    <p className={small}>
                      Email sending isn&apos;t set up yet, so the store can&apos;t send this by
                      itself. This opens an email in your mail app, already written, for you to
                      send.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {canShip || order.status === "SHIPPED" ? (
              <details className="border-t border-line pt-3" open={order.status === "IN_PRODUCTION"}>
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
                  {order.status === "SHIPPED"
                    ? "Change tracking details"
                    : isPickup
                      ? "Mark as handed over or shipped"
                      : "Mark as shipped"}
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
                    {emailsOn ? (
                      <label className="flex min-h-11 items-center gap-3">
                        <input type="checkbox" name="notify" defaultChecked={!isPickup} className="h-5 w-5 accent-[var(--color-accent)]" />
                        <span>Email the customer these tracking details</span>
                      </label>
                    ) : null}
                  </OrderActionForm>
                </div>
              </details>
            ) : null}

            {order.status === "SHIPPED" ? (
              <OrderActionForm
                action={deliveredAction}
                orderNumber={order.orderNumber}
                submitLabel="Mark as delivered"
              >
                {emailsOn ? (
                  <label className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" name="notify" defaultChecked={!isPickup} className="h-5 w-5 accent-[var(--color-accent)]" />
                    <span>Email the customer that it arrived</span>
                  </label>
                ) : null}
              </OrderActionForm>
            ) : null}

            {order.status === "CANCELLED" ? (
              <p className="text-bone-dim">
                This order was cancelled.
                {!canRefund
                  ? " Nothing more to do."
                  : order.refundedCents > 0
                    ? ` ${formatMoney(refundable)} has not been refunded.`
                    : " The customer has not been refunded yet."}
              </p>
            ) : null}
            {order.status === "REFUNDED" ? (
              <p className="text-bone-dim">
                {refundable > 0
                  ? `This order was closed by a refund, but ${formatMoney(refundable)} of it did not go through. Use Refund to send it again.`
                  : "This order was refunded in full. Nothing more to do."}
              </p>
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
              <a href={`mailto:${order.email}`} className="link">
                {order.email}
              </a>
              <Link
                href={`/admin/customers/${order.customerId}`}
                className="inline-flex min-h-11 items-center text-sm link"
              >
                Their details and other orders
              </Link>
              {isInboxConfigured() ? (
                <Link
                  href={`/admin/inbox/new?to=${encodeURIComponent(order.email)}&subject=${encodeURIComponent(`Your ${siteConfig.name} order ${order.orderNumber}`)}`}
                  className="inline-flex min-h-11 items-center text-sm link"
                >
                  Write to them about this order
                </Link>
              ) : null}
            </div>
            {emailsOn ? (
              <OrderActionForm
                action={resendConfirmationAction}
                orderNumber={order.orderNumber}
                submitLabel="Send the confirmation email again"
                pendingLabel="Sending…"
              />
            ) : (
              <p className={small}>
                Email sending isn&apos;t set up yet, so customers don&apos;t get order emails.
              </p>
            )}
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
            ) : isPickup ? (
              <p className="text-bone-dim">
                {order.shippingName}
                <br />
                Pickup or handed over. Nothing to ship.
              </p>
            ) : (
              <p className="text-ember">No address on this order. Add it before fulfilling.</p>
            )}
            {open ? (
              <details open={!hasAddress && !isPickup}>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">
                  {hasAddress ? "Change address" : isPickup ? "Ship it instead" : "Add address"}
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
                <dd>{order.paidAt ? formatDateTime(order.paidAt) : "Not paid yet"}</dd>
              </div>
              {order.paymentProvider ? (
                <div>
                  <dt className={small}>Through</dt>
                  <dd className={viaSquare ? "capitalize" : undefined}>
                    {order.paymentProvider}
                    {viaSquare ? "" : " (recorded by hand)"}
                  </dd>
                </div>
              ) : null}
              {order.paymentRef ? (
                <div>
                  <dt className={small}>Payment reference</dt>
                  <dd className="break-all font-mono text-xs">{order.paymentRef}</dd>
                </div>
              ) : null}
              {order.refundedCents > 0 ? (
                <div>
                  <dt className={small}>Refunded so far</dt>
                  <dd>
                    {formatMoney(order.refundedCents)} of {formatMoney(order.totalCents)}
                  </dd>
                </div>
              ) : null}
            </dl>

            {canRefund ? (
              <details className="border-t border-line pt-3">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
                  Refund
                </summary>
                <div className="flex flex-col gap-3 pt-2">
                  <p className={small}>
                    Sends the money back to the customer through Square. This can&apos;t be
                    undone. A full refund also closes the order.
                    {emailsOn ? " The customer is emailed." : ""}
                  </p>
                  <OrderActionForm
                    action={refundAction}
                    orderNumber={order.orderNumber}
                    submitLabel="Send refund"
                    pendingLabel="Refunding…"
                  >
                    <input type="hidden" name="refundedBefore" value={order.refundedCents} />
                    {/* The keys reset the amount to what is left, and clear the reason, after each refund. */}
                    <Field
                      key={refundable}
                      label={`Amount (up to ${formatMoney(refundable)})`}
                      name="amount"
                      defaultValue={(refundable / 100).toFixed(2)}
                      required
                    />
                    <Field
                      key={`reason-${refundable}`}
                      label="Reason (optional)"
                      name="reason"
                      id="field-refund-reason"
                      placeholder="Arrived damaged"
                    />
                  </OrderActionForm>
                </div>
              </details>
            ) : null}
          </section>

          {open ? (
            <section className={panel}>
              <h2 className={heading}>Cancel order</h2>
              <p className={small}>
                {unpaid
                  ? "Nothing has been paid, so cancelling just closes the order."
                  : viaSquare
                    ? "To cancel and give the money back, use Refund above: a full refund closes the order by itself. Cancelling here only stops the order and returns no money."
                    : "This order wasn't paid through the site, so cancelling here returns no money. Give it back the way it was paid."}
              </p>
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">
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
                    {emailsOn ? (
                      <label className="flex min-h-11 items-center gap-3">
                        <input type="checkbox" name="notify" defaultChecked className="h-5 w-5 accent-[var(--color-accent)]" />
                        <span>Email the customer that it was cancelled</span>
                      </label>
                    ) : null}
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
