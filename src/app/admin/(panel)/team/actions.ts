"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { setAccess } from "@/db/queries/team";
import { InviteError, createInvite, sendInvite } from "@/lib/admin/invites";
import { requireMaster } from "@/lib/admin/session";
import { isEmailConfigured } from "@/lib/email/send";

export type TeamFormState = { error?: string; done?: string };

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
});

/** Adds someone to the admin and emails them their invitation. Master account only. */
export async function inviteAction(_previous: TeamFormState, form: FormData): Promise<TeamFormState> {
  const admin = await requireMaster();
  const parsed = inviteSchema.safeParse({ name: form.get("name"), email: form.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (!isEmailConfigured()) return { error: "Email isn't set up yet, so the invitation can't be sent." };

  let adminId: string;
  try {
    adminId = await createInvite(parsed.data, admin.name);
  } catch (error) {
    if (error instanceof InviteError) return { error: error.message };
    throw error;
  }
  const sent = await sendInvite(adminId);
  refresh();
  return sent
    ? { done: `Invitation sent to ${parsed.data.email}.` }
    : { error: "The account was made but the email didn't send. It will be tried again shortly, or use Send again." };
}

const idSchema = z.string().uuid();

/** Emails a fresh invitation link. The earlier link stops working. */
export async function resendInviteAction(_previous: TeamFormState, form: FormData): Promise<TeamFormState> {
  await requireMaster();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "That didn't work. Refresh and try again." };
  const sent = await sendInvite(id.data);
  refresh();
  return sent ? { done: "Sent again." } : { error: "The email didn't send." };
}

/** Takes someone's access away, or gives it back. */
export async function setAccessAction(_previous: TeamFormState, form: FormData): Promise<TeamFormState> {
  const admin = await requireMaster();
  const id = idSchema.safeParse(form.get("id"));
  const allowed = form.get("allowed") === "yes";
  if (!id.success || id.data === admin.id) return { error: "That didn't work. Refresh and try again." };
  const changed = await setAccess(getDb(), id.data, allowed);
  refresh();
  return changed ? { done: allowed ? "Access given back." : "Access removed." } : { error: "That account can't be changed." };
}
