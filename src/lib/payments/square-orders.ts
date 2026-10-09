import "server-only";
import { getDb } from "@/db";
import { markCartsRecovered } from "@/db/queries/carts";
import { type CarriedCheckout, findCheckout } from "@/db/queries/checkouts";
import { findSellables } from "@/db/queries/catalog";
import { findDiscountByCode, findDiscountById } from "@/db/queries/discounts";
import { subscribe } from "@/db/queries/subscribers";
import { sendOrderPlaced } from "@/lib/email/order-emails";
import {
  type PaidOrderInput,
  findOrderNumberByPaymentRef,
  recordEvent,
  recordPaidOrder,
} from "@/db/queries/orders";
import {
  ORDER_SOURCE,
  TAX_CHARGE_UID,
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
 *
 * `carried` is the delivery address the customer gave on the store's own checkout,
 * when there is one. It is what any sales tax was worked out for.
 */
export function readSquareOrder(
  event: EventRef,
  payment: SquarePayment,
  order: SquareOrder,
  carried: CarriedCheckout | null = null,
): Reading {
  // The same Square account can take payments elsewhere (in person, invoices).
  if (order.metadata?.source !== ORDER_SOURCE) return { problem: "not a site order" };
  if (payment.status !== "COMPLETED") return { problem: `payment is ${payment.status}` };
  if (payment.order_id !== order.id) return { problem: "payment is for another order" };

  const fulfillment = order.fulfillments?.find((item) => item.shipment_details);
  const recipient = fulfillment?.shipment_details?.recipient;
  const squareAddress = recipient?.address ?? payment.shipping_address;
  // Normally the address is the one taken on our own checkout and Square has none.
  // If Square's page did ask (the fallback), what the customer left there is the
  // latest word on where it goes.
  const fromSquare = Boolean(squareAddress?.address_line_1);
  const address =
    carried && !fromSquare
      ? carried.shippingAddress
      : {
          line1: squareAddress?.address_line_1 ?? "",
          ...(squareAddress?.address_line_2 ? { line2: squareAddress.address_line_2 } : {}),
          city: squareAddress?.locality ?? "",
          state: squareAddress?.administrative_district_level_1 ?? "",
          postalCode: squareAddress?.postal_code ?? "",
          country: squareAddress?.country ?? "",
        };
  // When the payment page took no address, Square keeps the buyer's email on a
  // "digital" fulfillment instead of a shipment.
  const digital = order.fulfillments?.find((item) => item.digital_details)?.digital_details?.recipient;
  const email = payment.buyer_email_address ?? recipient?.email_address ?? digital?.email_address;
  const total = order.total_money?.amount;
  const paid = payment.amount_money?.amount;

  if (!email) return { problem: "no buyer email on the payment or the order" };
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
    (fromSquare ? recipient?.display_name?.trim() : "") ||
    carried?.shippingName.trim() ||
    recipient?.display_name?.trim() ||
    [squareAddress?.first_name, squareAddress?.last_name].filter(Boolean).join(" ") ||
    null;

  // A paid order is always saved. If there is no address for it, it is saved
  // without one and flagged, so someone gets it from the customer before it ships.
  const attention: string[] = address.line1
    ? []
    : ["No shipping address came with this order. Ask the customer for it before fulfilling."];

  // Sales tax is on the order as a charge of its own, next to shipping. Anything
  // Square worked out as tax itself (it shouldn't have) counts as tax too.
  const taxCharge = (order.service_charges ?? []).find((charge) => charge.uid === TAX_CHARGE_UID);
  const chargedTaxCents = taxCharge?.applied_money?.amount ?? taxCharge?.amount_money?.amount ?? 0;
  const serviceChargesCents = order.total_service_charge_money?.amount ?? 0;
  const taxCents = (order.total_tax_money?.amount ?? 0) + chargedTaxCents;
  // Tax was worked out for the address given on our checkout. If the customer then
  // put a different place on Square's page, someone should look at it.
  const zip = (value: string) => value.trim().slice(0, 5);
  if (
    carried &&
    fromSquare &&
    (zip(address.postalCode) !== zip(carried.shippingAddress.postalCode) ||
      address.state.trim().toUpperCase() !== carried.shippingAddress.state)
  ) {
    attention.push(
      `The address was changed on the payment page. Sales tax was worked out for ${carried.shippingAddress.city}, ${carried.shippingAddress.state} ${carried.shippingAddress.postalCode}.`,
    );
  }
  if (carried && carried.taxCents !== taxCents) {
    attention.push(
      "The sales tax on this payment isn't what checkout worked out. Compare it with the payment in Square.",
    );
  }

  return {
    order: {
      event,
      paymentRef: payment.id,
      paymentProvider: "square",
      email,
      customerName: name,
      phone: (fromSquare ? recipient?.phone_number : null) ?? carried?.phone ?? recipient?.phone_number ?? null,
      currency: (order.total_money?.currency ?? "USD").toLowerCase(),
      subtotalCents: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
      discountCents: order.total_discount_money?.amount ?? 0,
      shippingCents: Math.max(0, serviceChargesCents - chargedTaxCents),
      taxCents,
      totalCents: total,
      shippingName: name ?? email,
      shippingAddress: address,
      shippingMethod: "Standard shipping",
      discountCode: order.metadata?.discount_code ?? null,
      discountCodeId: order.metadata?.discount_id ?? null,
      wantsMarketing: order.metadata?.marketing === "yes",
      ...(attention.length ? { attention } : {}),
      items,
    },
  };
}

export function orderFromSquare(
  event: EventRef,
  payment: SquarePayment,
  order: SquareOrder,
  carried: CarriedCheckout | null = null,
): PaidOrderInput | null {
  const reading = readSquareOrder(event, payment, order, carried);
  return "order" in reading ? reading.order : null;
}

export type Settled =
  | { status: "saved"; orderNumber: string | null; order: PaidOrderInput; receiptUrl: string | null }
  | { status: "not_paid" }
  | { status: "not_ours" }
  /** One of this site's orders was paid but could not be saved. Must be retried. */
  | { status: "unreadable"; problem: string };

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
  const db = getDb();
  // The address taken on our own checkout. If it can't be read now, this fails
  // and is tried again, rather than saving a paid order with nowhere to send it.
  const carried = order?.metadata?.source === ORDER_SOURCE ? await findCheckout(db, payment.order_id) : null;
  const reading = order ? readSquareOrder(event, payment, order, carried) : { problem: "order not found" };

  if (!("order" in reading)) {
    if (order?.metadata?.source === ORDER_SOURCE) {
      console.error(
        `[square] Paid order ${order.id} could not be saved: ${reading.problem}. Payment ${payment.id}.`,
      );
      return { status: "unreadable", problem: reading.problem };
    }
    await recordEvent(db, event);
    return { status: "not_ours" };
  }
  const input = reading.order;

  // Tie each line back to the catalog, so sales can be reported by product and
  // category. The order keeps its own copy of names and prices either way.
  try {
    const sellables = await findSellables(db, [...new Set(input.items.map((item) => item.slug))]);
    for (const item of input.items) {
      const match = sellables.find(
        (sellable) =>
          sellable.slug === item.slug &&
          sellable.color === item.colorName &&
          sellable.size === item.size,
      );
      if (!match) continue;
      item.productId = match.productId;
      item.variantId = match.variantId;
      item.sku = match.sku;
      item.imageUrl = match.imageUrl;
    }
  } catch (error) {
    console.error("[square] Could not link order lines to the catalog", error);
  }

  // The code the customer used, if it still exists. Found by its id first, so a
  // code renamed since the payment page was opened is still counted.
  if (input.discountCode || input.discountCodeId) {
    try {
      const claimedId = input.discountCodeId;
      const code =
        (claimedId && /^[0-9a-f-]{36}$/i.test(claimedId) ? await findDiscountById(db, claimedId) : null) ??
        (input.discountCode ? await findDiscountByCode(db, input.discountCode) : null);
      input.discountCodeId = code?.id ?? null;
    } catch (error) {
      input.discountCodeId = null;
      console.error("[square] Could not look up the discount code on a paid order", error);
    }
  }

  const result = await recordPaidOrder(db, input);
  const orderNumber =
    result.status === "created"
      ? result.orderNumber
      : await findOrderNumberByPaymentRef(db, input.paymentRef);
  // Only the call that actually created the order sends the confirmation, so the
  // customer gets exactly one.
  if (result.status === "created") {
    // They paid, so the cart they started is no longer one to remind them about.
    try {
      await markCartsRecovered(db, {
        email: input.email,
        paymentOrderRef: payment.order_id,
        orderNumber: result.orderNumber,
      });
    } catch (error) {
      console.error("[square] Could not close the saved cart for a paid order", error);
    }
    // The marketing tick only counts now that the order is paid.
    if (input.wantsMarketing) {
      try {
        await subscribe(db, input.email, "checkout");
      } catch (error) {
        console.error("[square] Could not add a buyer to the marketing list", error);
      }
    }
    await sendOrderPlaced(result.orderNumber);
  }
  return { status: "saved", orderNumber, order: input, receiptUrl: payment.receipt_url ?? null };
}
