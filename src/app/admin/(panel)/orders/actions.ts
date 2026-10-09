"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import {
  OrderError,
  addNote,
  cancelOrder,
  markDelivered,
  markInProduction,
  markShipped,
  resolveAttention,
  updateShippingAddress,
} from "@/db/queries/admin-orders";
import { requireAdmin } from "@/lib/admin/session";

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
  return run(form, "Marked as shipped.", async (number, actor) => {
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
