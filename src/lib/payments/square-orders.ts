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

type Reading = { order: PaidOrderInput } | { problem: string };

/**
 * Turns a completed Square payment and its order into the order to save, or says
 * what is missing. The reason never includes customer details, so it is safe to log.
 */
export function readSquareOrder(
  event: EventRef,
  payment: SquarePayment,
  order: SquareOrder,
): Reading {
  // The same Square account can take payments elsewhere (in person, invoices).
  if (order.metadata?.source !== ORDER_SOURCE) return { problem: "not a site order" };
  if (payment.status !== "COMPLETED") return { problem: `payment is ${payment.status}` };
  if (payment.order_id !== order.id) return { problem: "payment is for another order" };

  const fulfillment = order.fulfillments?.find((item) => item.shipment_details);
  const recipient = fulfillment?.shipment_details?.recipient;
  const address = recipient?.address ?? payment.shipping_address;
  const email = payment.buyer_email_address ?? recipient?.email_address;
  const total = order.total_money?.amount;
  const paid = payment.amount_money?.amount;

  if (!email) return { problem: "no buyer email on the payment or the order" };
  if (!address?.address_line_1) {
    const types = (order.fulfillments ?? []).map((item) => item.type ?? "?").join(",") || "none";
    return { problem: `no shipping address (fulfillments: ${types})` };
  }
  if (total === undefined || paid === undefined) return { problem: "missing totals" };
  // Never treat a part payment as a paid order.
  if (paid < total) return { problem: `paid ${paid} of ${total}` };

  const items: PaidOrderInput["items"] = [];
  for (const line of order.line_items ?? []) {
    const quantity = Number(line.quantity);
    const unitPriceCents = line.base_price_money?.amount;
    const { slug, color, size } = line.metadata ?? {};
    if (!slug || !color || !size) {
      const keys = Object.keys(line.metadata ?? {}).join(",") || "none";
      return { problem: `line item is missing its product details (metadata: ${keys})` };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || unitPriceCents === undefined) {
      return { problem: "line item has no readable quantity or price" };
    }
    items.push({
      slug,
      productName: line.name ?? slug,
      colorName: color,
      size,
      quantity,
      unitPriceCents,
    });
  }
  if (items.length === 0) return { problem: "order has no line items" };

  const name =
    recipient?.display_name?.trim() ||
    [address.first_name, address.last_name].filter(Boolean).join(" ") ||
    null;

  return {
    order: {
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
    },
  };
}

export function orderFromSquare(
  event: EventRef,
  payment: SquarePayment,
  order: SquareOrder,
): PaidOrderInput | null {
  const reading = readSquareOrder(event, payment, order);
  return "order" in reading ? reading.order : null;
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
  const reading = order ? readSquareOrder(event, payment, order) : { problem: "order not found" };
  const db = getDb();

  if (!("order" in reading)) {
    if (order?.metadata?.source === ORDER_SOURCE) {
      console.error(
        `[square] Paid order ${order.id} could not be saved: ${reading.problem}. Payment ${payment.id}.`,
      );
    }
    await recordEvent(db, event);
    return { status: "not_ours" };
  }
  const input = reading.order;

  const result = await recordPaidOrder(db, input);
  const orderNumber =
    result.status === "created"
      ? result.orderNumber
      : await findOrderNumberByPaymentRef(db, input.paymentRef);
  return { status: "saved", orderNumber, order: input, receiptUrl: payment.receipt_url ?? null };
}
