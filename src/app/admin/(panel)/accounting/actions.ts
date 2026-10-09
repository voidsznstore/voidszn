"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import {
  AccountingError,
  addExpense,
  addRecurring,
  deleteExpense,
  deleteRecurring,
  endRecurring,
  saveAssumptions,
} from "@/db/queries/accounting";
import { isExpenseCategory } from "@/lib/accounting/categories";
import { addMonths, dayOf, isDay } from "@/lib/accounting/days";
import { requireAdmin, requireMaster } from "@/lib/admin/session";
import { parseDollars } from "@/lib/money";

/** `at` changes with every success, so a form can tell a second "Added." from the first and clear itself. */
export type MoneyFormState = { error?: string; done?: string; at?: number };

/** No entry can be dated before the store existed, or it would fall outside every profit share. */
const EARLIEST_DAY = "2020-01-01";

const text = (form: FormData, name: string) => (typeof form.get(name) === "string" ? String(form.get(name)).trim() : "");
const id = z.string().uuid();

const failure = (error: unknown): MoneyFormState => {
  if (error instanceof AccountingError) return { error: error.message };
  throw error;
};

/** Records money the business spent. Anyone on the team can. */
export async function addExpenseAction(_previous: MoneyFormState, form: FormData): Promise<MoneyFormState> {
  const admin = await requireAdmin();
  const spentOn = text(form, "spentOn");
  const category = text(form, "category");
  const description = text(form, "description");
  const amountCents = parseDollars(text(form, "amount"));

  if (!isDay(spentOn)) return { error: "Pick the day it was spent." };
  if (spentOn > dayOf(new Date())) return { error: "That day hasn't happened yet." };
  if (spentOn < EARLIEST_DAY) return { error: "Check the year on that date." };
  if (!isExpenseCategory(category)) return { error: "Pick what kind of expense it is." };
  if (amountCents === null || amountCents <= 0) return { error: "Enter the amount as a number, like 25 or 25.50." };
  if (!description) return { error: "Say what it was for." };
  if (description.length > 200) return { error: "Keep the description under 200 characters." };

  try {
    await addExpense(getDb(), admin.name, { spentOn, category, amountCents, description });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { done: "Added.", at: Date.now() };
}

/*
 * Taking a cost out of the books raises the profit and every balance with it, so
 * removing or stopping one is for the master account. Anyone can add one.
 */

export async function deleteExpenseAction(form: FormData): Promise<void> {
  await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  if (!parsed.success) return;
  await deleteExpense(getDb(), parsed.data);
  refresh();
}

/** Records a cost that repeats every month or year, like a subscription. */
export async function addRecurringAction(_previous: MoneyFormState, form: FormData): Promise<MoneyFormState> {
  const admin = await requireAdmin();
  const name = text(form, "name");
  const category = text(form, "category");
  const every = text(form, "every");
  const startsOn = text(form, "startsOn");
  const amountCents = parseDollars(text(form, "amount"));

  if (!name) return { error: "Say what it is, like Vercel or Canva." };
  if (name.length > 100) return { error: "Keep the name under 100 characters." };
  if (!isExpenseCategory(category)) return { error: "Pick what kind of cost it is." };
  if (amountCents === null || amountCents <= 0) return { error: "Enter the amount as a number, like 20 or 19.99." };
  if (every !== "MONTH" && every !== "YEAR") return { error: "Pick monthly or yearly." };
  if (!isDay(startsOn)) return { error: "Pick the day of the first charge." };
  if (startsOn < EARLIEST_DAY) return { error: "Check the year on that date." };
  if (startsOn > addMonths(dayOf(new Date()), 12)) return { error: "The first charge can't be more than a year away." };

  try {
    await addRecurring(getDb(), admin.name, { name, category, amountCents, every, startsOn });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { done: "Added.", at: Date.now() };
}

/** Stops a repeating cost after today. What it has cost so far stays in the books. */
export async function endRecurringAction(form: FormData): Promise<void> {
  await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  if (!parsed.success) return;
  await endRecurring(getDb(), parsed.data, dayOf(new Date()));
  refresh();
}

/** Removes a repeating cost and everything it has added to the books. For one entered by mistake. */
export async function deleteRecurringAction(form: FormData): Promise<void> {
  await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  if (!parsed.success) return;
  await deleteRecurring(getDb(), parsed.data);
  refresh();
}

/** The stand-in figures. They change every partner's balance, so only the master account sets them. */
export async function saveAssumptionsAction(_previous: MoneyFormState, form: FormData): Promise<MoneyFormState> {
  await requireMaster();
  const percent = Number(text(form, "feePercent"));
  const fixed = parseDollars(text(form, "feeFixed"));
  const ship = parseDollars(text(form, "shipCost") || "0");

  if (!Number.isFinite(percent) || percent < 0 || percent > 20) return { error: "The card fee is a percentage between 0 and 20." };
  if (fixed === null || fixed > 1000) return { error: "Enter the fixed part of the card fee, like 0.30." };
  if (ship === null) return { error: "Enter the printer's shipping charge as a number, or leave it empty." };

  await saveAssumptions(getDb(), {
    feeBps: Math.round(percent * 100),
    feeFixedCents: fixed,
    shipCostCents: ship,
  });
  refresh();
  return { done: "Saved." };
}
