"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { FormError } from "@/db/queries/admin-catalog";
import {
  type CustomerInput,
  createCustomer,
  deleteCustomer,
  updateCustomer,
} from "@/db/queries/admin-customers";
import { requireAdmin } from "@/lib/admin/session";

export type CustomerFormState = { error?: string; saved?: boolean; note?: string };

const KEPT_OFF =
  "They unsubscribed, so they stay off the marketing list. To put them back, tick the box again on this page, and only if they asked.";

const text = (max: number) => z.string().trim().max(max);

const schema = z.object({
  name: text(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  phone: text(40),
  line1: text(200),
  line2: text(200),
  city: text(100),
  state: text(60),
  postalCode: text(20),
  acceptsEmail: z.boolean(),
  notes: text(2000),
});

/** Reads the customer form. An address is all or nothing: a street needs the rest. */
function read(form: FormData): { input: CustomerInput } | { error: string } {
  const value = (name: string) => form.get(name) ?? "";
  const parsed = schema.safeParse({
    name: value("name"),
    email: value("email"),
    phone: value("phone"),
    line1: value("line1"),
    line2: value("line2"),
    city: value("city"),
    state: value("state"),
    postalCode: value("postalCode"),
    acceptsEmail: form.get("acceptsEmail") === "on",
    notes: value("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const { line1, line2, city, state, postalCode, ...rest } = parsed.data;
  const anyAddress = Boolean(line1 || line2 || city || state || postalCode);
  if (anyAddress && !(line1 && city && state && postalCode)) {
    return { error: "Finish the address (street, city, state and ZIP), or clear it." };
  }
  return {
    input: {
      ...rest,
      address: anyAddress
        ? { line1, ...(line2 ? { line2 } : {}), city, state, postalCode, country: "US" }
        : null,
    },
  };
}

export async function createCustomerAction(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  await requireAdmin();
  const parsed = read(form);
  if ("error" in parsed) return { error: parsed.error };

  let result;
  try {
    result = await createCustomer(getDb(), parsed.input);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  redirect(`/admin/customers/${result.id}`);
}

export async function updateCustomerAction(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That customer could not be found." };
  const parsed = read(form);
  if ("error" in parsed) return { error: parsed.error };

  let result;
  try {
    result = await updateCustomer(getDb(), id.data, parsed.input, form.get("knewOptOut") === "1");
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true, note: result.keptOptOut ? KEPT_OFF : undefined };
}

export async function deleteCustomerAction(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That customer could not be found." };

  try {
    await deleteCustomer(getDb(), id.data);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  redirect("/admin/customers");
}
