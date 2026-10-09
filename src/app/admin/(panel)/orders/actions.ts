"use server";

import { createHash } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import {
  OrderError,
  addNote,
  cancelOrder,
  getOrderDetail,
  markDelivered,
  markInProduction,
  markShipped,
  REFUND_ATTEMPTS,
  recordRefund,
  recordRefundRefusal,
  resolveAttention,
  updateShippingAddress,
} from "@/db/queries/admin-orders";
import {
  type ManualOrderInput,
  PAYMENT_METHODS,
  createManualOrder,
  markPaid,
} from "@/db/queries/admin-manual-orders";
import { AccountingError, setOrderCost } from "@/db/queries/accounting";
import { resetRelay } from "@/db/queries/relay";
import { requireAdmin } from "@/lib/admin/session";
import { parseDollars } from "@/lib/money";
import {
  sendOrderCancelled,
  sendOrderDelivered,
  sendOrderPlaced,
  sendOrderRefunded,
  sendOrderShipped,
} from "@/lib/email/order-emails";
import { SquareError, refundPayment } from "@/lib/payments/square";
import { pushAddressToRelay, sendOrderToRelay, withdrawFromRelay } from "@/lib/relay/orders";

export type OrderActionState = { error?: string; done?: string };

const orderNumber = z.string().regex(/^VS-[A-Z0-9]{6,12}$/);
const text = (max: number) => z.string().trim().max(max);

/** Runs one change to an order for a signed-in admin and reports back in plain words. */
async function run(
  form: FormData,
  done: string,
  work: (number: string, actor: string) => Promise<void | { error: string }>,
): Promise<OrderActionState> {
  const admin = await requireAdmin();
  const number = orderNumber.safeParse(form.get("orderNumber"));
  if (!number.success) return { error: "That order could not be found." };

  try {
    const result = await work(number.data, admin.email);
    if (result?.error) return { error: result.error };
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    console.error("[admin] Order change failed", error);
    return { error: "Something went wrong. Nothing was changed. Try again." };
  }
  refresh();
  return { done };
}

export async function inProductionAction(_previous: OrderActionState, form: FormData) {
  let relayNote = "";
  const result = await run(form, "Marked as sent to the printer.", async (number, actor) => {
    await markInProduction(getDb(), number, actor);
    // Placed by hand, so any copy the relay made or half-made must not be printed as well.
    relayNote = await withdrawFromRelay(number, "placed by hand");
  });
  return result.done ? { done: `Marked as sent to the printer.${relayNote}` } : result;
}

/** Places the order with the printer through the relay store. */
export async function relayAction(_previous: OrderActionState, form: FormData) {
  let relayOrderId = "";
  const result = await run(form, "Sent.", async (number, actor) => {
    const detail = await getOrderDetail(getDb(), number);
    if (!detail) return { error: "That order could not be found." };
    // After a failure the old try is cleared first, so a fresh copy is made.
    if (form.get("again") === "yes" && !(await resetRelay(getDb(), number, actor))) {
      return { error: "This order can't be sent again right now. Refresh the page to see where it stands." };
    }
    const outcome = await sendOrderToRelay(detail.order.id, actor);
    if (!outcome.ok) {
      // The reason is kept on the order, so show the page as it now stands.
      refresh();
      return { error: outcome.error };
    }
    relayOrderId = outcome.relayOrderId;
  });
  return result.done ? { done: `Sent to the printer. It is order ${relayOrderId} in the relay store.` } : result;
}

export async function shippedAction(_previous: OrderActionState, form: FormData) {
  let emailNote = "";
  const result = await run(form, "Saved.", async (number, actor) => {
    const parsed = z
      .object({
        carrier: text(60),
        number: text(100),
        url: z.union([z.literal(""), z.string().trim().url().max(500).startsWith("https://")]),
      })
      .safeParse({
        carrier: form.get("carrier") ?? "",
        number: form.get("trackingNumber") ?? "",
        url: form.get("trackingUrl") ?? "",
      });
    if (!parsed.success) return { error: "The tracking link must start with https://." };
    await markShipped(getDb(), number, actor, parsed.data);

    if (form.get("notify") === "on") {
      const email = await sendOrderShipped(number);
      emailNote = email.sent
        ? " The customer has been emailed."
        : ` The customer was not emailed: ${email.reason}`;
    }
  });
  return result.done ? { done: `Marked as shipped.${emailNote}` } : result;
}

const dollars = z
  .string()
  .trim()
  .regex(/^\$?\d{1,6}(\.\d{1,2})?$/, "Enter the amount as a number, like 12 or 12.50.")
  .transform((value) => Math.round(Number(value.replace("$", "")) * 100));

/**
 * Gives money back through the payment processor, then records it on the order.
 * The amount is checked against what is left to refund, here and by the processor.
 */
export async function refundAction(_previous: OrderActionState, form: FormData) {
  let emailNote = "";
  let relayNote = "";
  const result = await run(form, "Refunded.", async (number, actor) => {
    const parsed = z
      .object({ amount: dollars, reason: text(190), refundedBefore: z.coerce.number().int().min(0) })
      .safeParse({
        amount: form.get("amount") ?? "",
        reason: form.get("reason") ?? "",
        refundedBefore: form.get("refundedBefore"),
      });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the amount." };
    const { amount, reason, refundedBefore } = parsed.data;

    const db = getDb();
    const detail = await getOrderDetail(db, number);
    if (!detail) return { error: "That order could not be found." };
    const { order } = detail;
    if (order.paymentProvider !== "square" || !order.paymentRef) {
      return { error: "This order wasn't paid through Square, so it can't be refunded from here." };
    }
    if (order.refundedCents !== refundedBefore) {
      return { error: "This order has changed since the page loaded. Refresh and try again." };
    }
    const left = order.totalCents - order.refundedCents;
    if (amount <= 0) return { error: "Enter an amount above zero." };
    if (amount > left) {
      return { error: `Only $${(left / 100).toFixed(2)} of this order is left to refund.` };
    }

    // Each finished attempt, successful or not, makes the next one a new refund to
    // Square. An attempt that never got an answer keeps its key, so trying it again
    // (or a second click) can't refund twice.
    const attempts = detail.events.filter((event) => REFUND_ATTEMPTS.includes(event.type)).length;
    const idempotencyKey = createHash("sha256")
      .update(`refund:${order.id}:${refundedBefore}:${amount}:${attempts}`)
      .digest("hex")
      .slice(0, 40);

    let refund;
    try {
      refund = await refundPayment({ paymentId: order.paymentRef, amountCents: amount, reason, idempotencyKey });
    } catch (error) {
      // A plain "no" from Square. Server trouble or "slow down" is not a no.
      const refused =
        error instanceof SquareError && error.status >= 400 && error.status < 500 && error.status !== 429;
      if (refused) {
        console.error("[admin] Square refused a refund", error.codes);
        const why = `Square refused it (${error.codes.join(", ") || error.status})`;
        await recordRefundRefusal(db, number, actor, { amountCents: amount, why });
        refresh();
        return { error: `${why}. Nothing was refunded.` };
      }
      // No answer from Square: it may or may not have gone through. Sending the
      // same refund again is safe and settles it.
      console.error("[admin] Refund got no answer from Square", error);
      return {
        error:
          "Square didn't answer, so it isn't clear whether the refund went through. Press Send refund again with the same amount: it can't refund twice.",
      };
    }
    if (refund.status === "FAILED" || refund.status === "REJECTED") {
      await recordRefundRefusal(db, number, actor, {
        amountCents: amount,
        why: "Square could not make it",
      });
      refresh();
      return { error: "Square could not make the refund. Nothing was refunded." };
    }

    try {
      await recordRefund(db, number, actor, {
        amountCents: amount,
        refundedBefore,
        reason,
        refundId: refund.id,
      });
    } catch (error) {
      if (error instanceof OrderError) throw error;
      console.error("[admin] A refund was sent but could not be saved", error);
      return {
        error:
          "The refund was sent, but the order could not be updated. Press Send refund again with the same amount to finish: it can't refund twice.",
      };
    }

    // A full refund closes the order, so the printer must not go on to make it.
    if (order.refundedCents + amount >= order.totalCents) relayNote = await withdrawFromRelay(number, "refunded");

    const email = await sendOrderRefunded(number, amount);
    emailNote = email.sent ? " The customer has been emailed." : "";
  });
  return result.done ? { done: `Refunded.${relayNote}${emailNote}` } : result;
}

/** Sends the order confirmation again, for a customer who says they never got it. */
export async function resendConfirmationAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Confirmation sent again.", async (number) => {
    const email = await sendOrderPlaced(number, { again: true });
    if (!email.sent) return { error: email.reason ?? "The email could not be sent." };
  });
}

/** What to add to "done" after an email the owner asked for was, or wasn't, sent. */
const emailedNote = (email: { sent: boolean; reason?: string }) =>
  email.sent ? " The customer has been emailed." : ` The customer was not emailed: ${email.reason}`;

export async function deliveredAction(_previous: OrderActionState, form: FormData) {
  let emailNote = "";
  const result = await run(form, "Marked as delivered.", async (number, actor) => {
    await markDelivered(getDb(), number, actor);
    if (form.get("notify") === "on") emailNote = emailedNote(await sendOrderDelivered(number));
  });
  return result.done ? { done: `Marked as delivered.${emailNote}` } : result;
}

export async function cancelAction(_previous: OrderActionState, form: FormData) {
  let emailNote = "";
  let relayNote = "";
  const result = await run(form, "Order cancelled.", async (number, actor) => {
    await cancelOrder(getDb(), number, actor, text(300).parse(form.get("reason") ?? ""));
    // If the printer already has it, it is cancelled there too so it isn't made.
    relayNote = await withdrawFromRelay(number, "cancelled");
    if (form.get("notify") === "on") emailNote = emailedNote(await sendOrderCancelled(number));
  });
  return result.done ? { done: `Order cancelled.${relayNote}${emailNote}` } : result;
}

export async function addressAction(_previous: OrderActionState, form: FormData) {
  let relayNote = "";
  const result = await run(form, "Address saved.", async (number, actor) => {
    const required = (label: string, max: number) => text(max).min(1, `Enter the ${label}.`);
    const parsed = z
      .object({
        name: required("name", 120),
        line1: required("street address", 200),
        line2: text(200),
        city: required("city", 100),
        state: required("state", 60),
        postalCode: required("ZIP code", 20),
        country: text(2).toUpperCase().length(2, "Use a two-letter country code, like US."),
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the address." };

    const { name, line2, ...rest } = parsed.data;
    await updateShippingAddress(getDb(), number, actor, {
      name,
      address: { ...rest, ...(line2 ? { line2 } : {}) },
    });
    relayNote = await pushAddressToRelay(number);
  });
  return result.done ? { done: `Address saved.${relayNote}` } : result;
}

export async function resolveAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Marked as dealt with.", (number, actor) =>
    resolveAttention(getDb(), number, actor),
  );
}

export async function noteAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Note added.", async (number, actor) => {
    const note = text(1000).min(1).safeParse(form.get("note"));
    if (!note.success) return { error: "Write a note first." };
    await addNote(getDb(), number, actor, note.data);
  });
}

/** What the order really cost to make and send. Left empty, it goes back to the items' own costs. */
export async function costAction(_previous: OrderActionState, form: FormData) {
  await requireAdmin();
  const raw = typeof form.get("cost") === "string" ? String(form.get("cost")).trim() : "";
  const cents = raw === "" ? null : parseDollars(raw);
  if (raw !== "" && cents === null) return { error: "Enter the cost as a number, like 14 or 14.25." };
  return run(form, cents === null ? "Cleared." : "Saved.", async (number, actor) => {
    try {
      await setOrderCost(getDb(), number, actor, cents);
    } catch (error) {
      if (error instanceof AccountingError) return { error: error.message };
      throw error;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Orders added by hand                                                */
/* ------------------------------------------------------------------ */

const money = z.number().int().min(0).max(10_000_00);
const quantity = z.number().int().min(1, "Quantities start at 1.").max(999);

const manualOrderSchema = z.object({
  token: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Enter the customer's email address.").max(254),
  customerName: text(120).min(1, "Enter the customer's name."),
  phone: text(40),
  shipTo: z
    .object({
      line1: text(200).min(1, "Enter the street address."),
      line2: text(200),
      city: text(100).min(1, "Enter the city."),
      state: text(60).min(1, "Enter the state."),
      postalCode: text(20).min(1, "Enter the ZIP code."),
    })
    .nullable(),
  items: z
    .array(
      z.union([
        z.object({ variantId: z.string().uuid(), quantity, unitPriceCents: money }),
        z.object({
          name: text(120).min(1, "Give every custom item a name."),
          details: text(60),
          size: text(20),
          quantity,
          unitPriceCents: money,
        }),
      ]),
    )
    .min(1, "Add at least one item.")
    .max(50),
  shippingCents: money,
  discountCents: money,
  paidWith: z.enum(PAYMENT_METHODS).nullable(),
  note: text(1000),
  notify: z.boolean(),
});

export type CreateOrderResult = { error: string } | { orderNumber: string; emailNote?: string };

/** Adds an order by hand: one agreed outside the site's own checkout. */
export async function createOrderAction(input: unknown): Promise<CreateOrderResult> {
  const admin = await requireAdmin();

  const parsed = manualOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { notify, shipTo, ...rest } = parsed.data;
  const order: ManualOrderInput = {
    ...rest,
    shipTo: shipTo
      ? {
          line1: shipTo.line1,
          ...(shipTo.line2 ? { line2: shipTo.line2 } : {}),
          city: shipTo.city,
          state: shipTo.state,
          postalCode: shipTo.postalCode,
          country: "US",
        }
      : null,
  };

  let result;
  try {
    result = await createManualOrder(getDb(), admin.email, order);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    console.error("[admin] Adding an order failed", error);
    return { error: "Something went wrong. The order was not added. Try again." };
  }

  // Only the request that made the order emails, so a repeat can't email twice.
  if (!result.isNew || !notify) return { orderNumber: result.orderNumber };
  const email = await sendOrderPlaced(result.orderNumber);
  return {
    orderNumber: result.orderNumber,
    emailNote: email.sent ? undefined : `The customer was not emailed: ${email.reason}`,
  };
}

export async function paidAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Marked as paid.", async (number, actor) => {
    const method = z.enum(PAYMENT_METHODS).safeParse(form.get("method"));
    if (!method.success) return { error: "Choose how it was paid." };
    await markPaid(getDb(), number, actor, method.data);
  });
}
