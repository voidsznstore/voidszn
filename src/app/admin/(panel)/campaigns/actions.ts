"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { type CampaignInput, deleteDraft, saveCampaign, startCampaign } from "@/db/queries/admin-campaigns";
import { FormError } from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { sendCampaign, sendTest } from "@/lib/email/campaigns";
import { isEmailConfigured } from "@/lib/email/send";
import { unfilledSiteConfig } from "@/lib/site-config";
import { storagePublicUrl } from "@/lib/storage";

const text = (max: number) => z.string().trim().max(max);
const webLink = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || /^https:\/\/[^\s]+$/.test(value), "The button link must start with https://.");

const schema = z
  .object({
    id: z.string().uuid().optional(),
    subject: text(150).min(1, "Give the email a subject."),
    preheader: text(150),
    body: text(10_000).min(1, "Write the message."),
    imageUrl: z.string().url().max(500).nullable(),
    buttonLabel: text(40),
    buttonUrl: webLink,
  })
  .refine((value) => Boolean(value.buttonLabel) === Boolean(value.buttonUrl), {
    message: "A button needs both its words and its link. Fill in both, or clear both.",
  });

export type CampaignResult = { error: string } | { id: string; done?: string };

/** Reads the editor's contents and saves them as the draft. */
async function save(input: unknown): Promise<{ error: string } | { id: string; content: CampaignInput; email: string }> {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the email and try again." };

  const { id, ...content } = parsed.data;
  // Photos can only come from the store's own image storage.
  const storage = storagePublicUrl();
  if (content.imageUrl && !(storage && content.imageUrl.startsWith(`${storage}/`))) {
    return { error: "Add the photo again using the photo button." };
  }
  try {
    return { id: await saveCampaign(getDb(), admin.email, id, content), content, email: admin.email };
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
}

export async function saveCampaignAction(input: unknown): Promise<CampaignResult> {
  const saved = await save(input);
  if ("error" in saved) return saved;
  refresh();
  return { id: saved.id, done: "Draft saved." };
}

/** Saves the draft and sends one copy to the person signed in. */
export async function sendTestAction(input: unknown): Promise<CampaignResult> {
  const saved = await save(input);
  if ("error" in saved) return saved;
  if (!isEmailConfigured()) return { error: "Email sending isn't set up yet." };

  const result = await sendTest(saved.content, saved.email);
  refresh();
  return result.ok
    ? { id: saved.id, done: `Draft saved. A test is on its way to ${saved.email}.` }
    : { error: `The draft was saved, but the test wasn't sent: ${result.reason}` };
}

const progressNote = (progress: Awaited<ReturnType<typeof sendCampaign>>) =>
  progress.stopped
    ? `Sent to ${progress.sent} so far. ${progress.stopped} ${progress.pending} still to go: press Continue sending.`
    : undefined;

/** Saves the draft and sends it to everyone who gets marketing emails. */
export async function sendCampaignAction(input: unknown): Promise<CampaignResult> {
  const saved = await save(input);
  if ("error" in saved) return saved;
  if (!isEmailConfigured()) return { error: "Email sending isn't set up yet." };
  if (unfilledSiteConfig().includes("mailingAddress")) {
    return {
      error:
        "The draft was saved, but it can't be sent yet. Marketing emails must show your business mailing address, and that hasn't been filled in.",
    };
  }

  try {
    await startCampaign(getDb(), saved.id);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  const progress = await sendCampaign(saved.id);
  refresh();
  return { id: saved.id, done: progressNote(progress) };
}

export type CampaignFormState = { error?: string; done?: string };

/** Carries on with a campaign that stopped part-way. */
export async function continueCampaignAction(
  _previous: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That campaign could not be found." };
  const progress = await sendCampaign(id.data);
  refresh();
  return progress.stopped
    ? { error: `${progress.stopped} ${progress.pending} still to go.` }
    : { done: "All sent." };
}

export async function deleteCampaignAction(
  _previous: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That campaign could not be found." };
  try {
    await deleteDraft(getDb(), id.data);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  redirect("/admin/campaigns");
}
