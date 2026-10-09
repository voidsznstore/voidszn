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
import { requireAdmin } from "@/lib/admin/session";
import { sendOrderPlaced, sendOrderRefunded, sendOrderShipped } from "@/lib/email/order-emails";
import { SquareError, refundPayment } from "@/lib/payments/square";

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
  return run(form, "Marked as sent to the printer.", (number, actor) =>
    markInProduction(getDb(), number, actor),
  );
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

    const email = await sendOrderRefunded(number, amount);
    emailNote = email.sent ? " The customer has been emailed." : "";
  });
  return result.done ? { done: `Refunded.${emailNote}` } : result;
}

/** Sends the order confirmation again, for a customer who says they never got it. */
export async function resendConfirmationAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Confirmation sent again.", async (number) => {
    const email = await sendOrderPlaced(number, { again: true });
    if (!email.sent) return { error: email.reason ?? "The email could not be sent." };
  });
}

export async function deliveredAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Marked as delivered.", (number, actor) => markDelivered(getDb(), number, actor));
}

export async function cancelAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Order cancelled.", (number, actor) =>
    cancelOrder(getDb(), number, actor, text(300).parse(form.get("reason") ?? "")),
  );
}

export async function addressAction(_previous: OrderActionState, form: FormData) {
  return run(form, "Address saved.", async (number, actor) => {
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
  });
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
