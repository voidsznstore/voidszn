"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { findDiscountById } from "@/db/queries/discounts";
import { requireAdmin } from "@/lib/admin/session";
import { type Automation, saveAutomation } from "@/lib/email/automation";
import { isAutomaticEmailKey, sampleEmail } from "@/lib/email/samples";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";

export type AutomationFormState = { error?: string; saved?: boolean; done?: string };

const codeId = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);

/** Saves the settings for cart reminders and the thank-you code. */
export async function saveAutomationAction(
  _previous: AutomationFormState,
  form: FormData,
): Promise<AutomationFormState> {
  await requireAdmin();

  const hours = [1, 2, 3].map((step) => Number(form.get(`hours${step}`)));
  if (hours.some((value) => !Number.isInteger(value) || value < 1 || value > 168)) {
    return { error: "Each wait is a whole number of hours, from 1 to 168 (a week)." };
  }
  if (!(hours[0] < hours[1] && hours[1] < hours[2])) {
    return { error: "Each reminder has to come later than the one before it." };
  }
  if (hours[1] - hours[0] < 12 || hours[2] - hours[1] < 12) {
    return { error: "Leave at least 12 hours between reminders, so nobody gets two close together." };
  }

  const codes = z
    .object({ code1: codeId, code2: codeId, code3: codeId, delivered: codeId })
    .safeParse({
      code1: form.get("code1") ?? "",
      code2: form.get("code2") ?? "",
      code3: form.get("code3") ?? "",
      delivered: form.get("delivered") ?? "",
    });
  if (!codes.success) return { error: "One of the codes couldn't be read. Pick it again." };

  const db = getDb();
  for (const id of Object.values(codes.data)) {
    if (id && !(await findDiscountById(db, id))) {
      return { error: "One of the codes no longer exists. Pick another, or none." };
    }
  }

  const value: Automation = {
    cart: {
      enabled: form.get("enabled") === "on",
      steps: [
        { hours: hours[0], discountCodeId: codes.data.code1 },
        { hours: hours[1], discountCodeId: codes.data.code2 },
        { hours: hours[2], discountCodeId: codes.data.code3 },
      ],
    },
    delivered: { discountCodeId: codes.data.delivered },
  };
  await saveAutomation(db, value);
  refresh();
  return { saved: true };
}

/** Sends the example of an automatic email to the person signed in. */
export async function sendSampleAction(
  _previous: AutomationFormState,
  form: FormData,
): Promise<AutomationFormState> {
  const admin = await requireAdmin();
  const key = String(form.get("key") ?? "");
  if (!isAutomaticEmailKey(key)) return { error: "That email could not be found." };
  if (!isEmailConfigured()) return { error: "Email sending isn't set up yet." };

  const email = await sampleEmail(getDb(), key);
  const result = await sendEmail({
    to: admin.email,
    ...email,
    subject: `[Test] ${email.subject}`,
    idempotencyKey: `sample/${key}/${Date.now()}`,
    kind: key.startsWith("cart") ? "marketing" : "order",
  });
  return result.ok ? { done: `Sent to ${admin.email}.` } : { error: `It wasn't sent: ${result.reason}` };
}
