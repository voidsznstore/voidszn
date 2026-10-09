"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { FormError } from "@/db/queries/admin-catalog";
import {
  type DiscountInput,
  createDiscount,
  deleteDiscount,
  setDiscountActive,
  updateDiscount,
} from "@/db/queries/admin-discounts";
import { fromLocalInput } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { CODE_PATTERN, normalizeCode } from "@/lib/discounts/describe";
import { POPUPS_TAG } from "@/lib/popups/shape";

export type DiscountFormState = { error?: string; saved?: boolean };

/** "12.50" or "12" as cents. Null when it isn't an amount of money. */
function toCents(raw: string): number | null {
  const tidy = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(tidy)) return null;
  return Math.round(Number(tidy) * 100);
}

/** Reads the discount form into something the database can save, or says what to fix. */
function read(form: FormData): { input: DiscountInput } | { error: string } {
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const on = (name: string) => form.get(name) === "on";

  const code = normalizeCode(value("code"));
  if (!CODE_PATTERN.test(code)) {
    return { error: "A code is 2 to 30 letters, numbers or dashes, like WELCOME10." };
  }

  const type = z.enum(["PERCENTAGE", "FIXED", "FREE_SHIPPING"]).safeParse(value("type"));
  if (!type.success) return { error: "Choose what the code gives." };

  let amount = 0;
  if (type.data === "PERCENTAGE") {
    amount = Number(value("percent"));
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return { error: "The percentage is a whole number from 1 to 100." };
    }
  } else if (type.data === "FIXED") {
    const cents = toCents(value("amount"));
    if (cents === null || cents < 1) return { error: "Enter the amount to take off, like 5 or 7.50." };
    amount = cents;
  }

  let minOrderCents = 0;
  if (on("hasMinimum")) {
    const cents = toCents(value("minimum"));
    if (cents === null || cents < 1) return { error: "Enter the smallest order the code works on, like 40." };
    minOrderCents = cents;
  }
  if (type.data === "FIXED" && minOrderCents > 0 && minOrderCents < amount) {
    return { error: "The minimum order is smaller than the amount the code takes off." };
  }

  let maxUses: number | null = null;
  if (on("hasLimit")) {
    maxUses = Number(value("maxUses"));
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000) {
      return { error: "The number of uses is a whole number, 1 or more." };
    }
  }

  const startsAt = value("startsAt") ? fromLocalInput(value("startsAt")) : null;
  if (value("startsAt") && !startsAt) return { error: "The start date couldn't be read." };
  let expiresAt: Date | null = null;
  if (on("hasEnd")) {
    expiresAt = fromLocalInput(value("expiresAt"));
    if (!expiresAt) return { error: "Choose when the code ends, or untick the end date." };
    if (startsAt && expiresAt <= startsAt) return { error: "The code ends before it starts." };
  }

  return {
    input: {
      code,
      type: type.data,
      value: amount,
      minOrderCents,
      maxUses,
      oncePerCustomer: on("oncePerCustomer"),
      firstOrderOnly: on("firstOrderOnly"),
      startsAt,
      expiresAt,
      isActive: on("isActive"),
      note: value("note").slice(0, 300),
    },
  };
}

export async function createDiscountAction(
  _previous: DiscountFormState,
  form: FormData,
): Promise<DiscountFormState> {
  await requireAdmin();
  const parsed = read(form);
  if ("error" in parsed) return parsed;

  let id: string;
  try {
    id = await createDiscount(getDb(), parsed.input);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  redirect(`/admin/discounts/${id}?created=1`);
}

export async function updateDiscountAction(
  _previous: DiscountFormState,
  form: FormData,
): Promise<DiscountFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That code could not be found." };
  const parsed = read(form);
  if ("error" in parsed) return parsed;

  try {
    await updateDiscount(getDb(), id.data, parsed.input);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  // A pop-up never offers a code that no longer works, so the store's pop-ups are read afresh.
  updateTag(POPUPS_TAG);
  refresh();
  return { saved: true };
}

/** The on/off switch in the list. */
export async function toggleDiscountAction(
  _previous: DiscountFormState,
  form: FormData,
): Promise<DiscountFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That code could not be found." };
  await setDiscountActive(getDb(), id.data, form.get("turn") === "on");
  updateTag(POPUPS_TAG);
  refresh();
  return { saved: true };
}

export async function deleteDiscountAction(
  _previous: DiscountFormState,
  form: FormData,
): Promise<DiscountFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That code could not be found." };
  await deleteDiscount(getDb(), id.data);
  updateTag(POPUPS_TAG);
  redirect("/admin/discounts?deleted=1");
}
