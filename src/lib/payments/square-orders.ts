import "server-only";
import { getDb } from "@/db";
import {
  type PaidOrderInput,
  findOrderNumberByPaymentRef,
  recordEvent,
  recordPaidOrder,
} from "@/db/queries/orders";
import {
  ORDER_SOURCE,
  type SquareOrder,
  type SquarePayment,
  getOrder,
  getPayment,
} from "./square";

type EventRef = { provider: string; id: string; type: string };

/**
 * Turns a completed Square payment and its order into the order to save. Returns
 * null when it is not one of this site's orders or something an order can't exist
 * without is missing.
 */
export function orderFromSquare(
  event: EventRef,
  payment: SquarePayment,
  order: SquareOrder,
): PaidOrderInput | null {
  // The same Square account can take payments elsewhere (in person, invoices).
  if (order.metadata?.source !== ORDER_SOURCE) return null;
  if (payment.status !== "COMPLETED" || payment.order_id !== order.id) return null;

  const recipient = order.fulfillments?.find((item) => item.shipment_details)?.shipment_details
    ?.recipient;
  const address = recipient?.address ?? payment.shipping_address;
  const email = payment.buyer_email_address ?? recipient?.email_address;
  const total = order.total_money?.amount;
  const paid = payment.amount_money?.amount;

  if (!email || !address?.address_line_1 || total === undefined || paid === undefined) return null;
  // Never treat a part payment as a paid order.
  if (paid < total) return null;

  const items: PaidOrderInput["items"] = [];
  for (const line of order.line_items ?? []) {
    const quantity = Number(line.quantity);
    const unitPriceCents = line.base_price_money?.amount;
    const { slug, color, size } = line.metadata ?? {};
    if (!slug || !color || !size || !Number.isInteger(quantity) || quantity < 1) return null;
    if (unitPriceCents === undefined) return null;
    items.push({
      slug,
      productName: line.name ?? slug,
      colorName: color,
      size,
      quantity,
      unitPriceCents,
    });
  }
  if (items.length === 0) return null;

  const name =
    recipient?.display_name?.trim() ||
    [address.first_name, address.last_name].filter(Boolean).join(" ") ||
    null;

  return {
    event,
    paymentRef: payment.id,
    paymentProvider: "square",
    email,
    customerName: name,
    phone: recipient?.phone_number ?? null,
    currency: (order.total_money?.currency ?? "USD").toLowerCase(),
    subtotalCents: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
    discountCents: order.total_discount_money?.amount ?? 0,
    shippingCents: order.total_service_charge_money?.amount ?? 0,
    taxCents: order.total_tax_money?.amount ?? 0,
    totalCents: total,
    shippingName: name ?? email,
    shippingAddress: {
      line1: address.address_line_1,
      ...(address.address_line_2 ? { line2: address.address_line_2 } : {}),
      city: address.locality ?? "",
      state: address.administrative_district_level_1 ?? "",
      postalCode: address.postal_code ?? "",
      country: address.country ?? "",
    },
    shippingMethod: "Standard shipping",
    items,
  };
}

export type Settled =
  | { status: "saved"; orderNumber: string | null; order: PaidOrderInput; receiptUrl: string | null }
  | { status: "not_paid" }
  | { status: "not_ours" };

/**
 * Saves the order for a payment, once. Called from the webhook and again when the
 * customer lands back on the site, whichever comes first; the second call changes
 * nothing.
 *
 * What was paid is always read from Square directly, never taken from the request
 * that triggered this.
 */
export async function settlePayment(paymentId: string, event: EventRef): Promise<Settled> {
  const payment = await getPayment(paymentId);
  if (!payment || payment.status !== "COMPLETED") return { status: "not_paid" };
  if (!payment.order_id) return { status: "not_ours" };

  const order = await getOrder(payment.order_id);
  const input = order ? orderFromSquare(event, payment, order) : null;
  const db = getDb();

  if (!input) {
    if (order?.metadata?.source === ORDER_SOURCE) {
      console.error(`[square] Paid order ${order.id} could not be read. Payment ${payment.id}.`);
    }
    await recordEvent(db, event);
    return { status: "not_ours" };
  }

  const result = await recordPaidOrder(db, input);
  const orderNumber =
    result.status === "created"
      ? result.orderNumber
      : await findOrderNumberByPaymentRef(db, input.paymentRef);
  return { status: "saved", orderNumber, order: input, receiptUrl: payment.receipt_url ?? null };
}
