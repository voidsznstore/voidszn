"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ENROL_PATH, currentSessionHash, requireAdmin } from "@/lib/admin/session";
import { LOCKOUT_MESSAGE } from "@/lib/admin/throttle";
import {
  checkSecondStep,
  recordGuess,
  regenerateRecoveryCodes,
  resetEnrolment,
  tooManyGuesses,
} from "@/lib/admin/two-step";

export type SecurityFormState = { error?: string; recoveryCodes?: string[] };

/** Both changes here need a fresh code, so a browser left signed in isn't enough to make them. */
async function confirmWithCode(adminId: string, form: FormData): Promise<string | null> {
  if (await tooManyGuesses(adminId)) return LOCKOUT_MESSAGE;
  const code = z.string().trim().min(6).max(20).safeParse(form.get("code"));
  const result = code.success ? await checkSecondStep(adminId, code.data) : { ok: false };
  if (!result.ok) {
    await recordGuess(adminId);
    return "That code isn't right. Enter the six digits your authenticator app shows now.";
  }
  return null;
}

export async function newRecoveryCodesAction(
  _previous: SecurityFormState,
  form: FormData,
): Promise<SecurityFormState> {
  const admin = await requireAdmin();
  const problem = await confirmWithCode(admin.id, form);
  if (problem) return { error: problem };
  return { recoveryCodes: await regenerateRecoveryCodes(admin.id) };
}

export async function replaceAuthenticatorAction(
  _previous: SecurityFormState,
  form: FormData,
): Promise<SecurityFormState> {
  const admin = await requireAdmin();
  const problem = await confirmWithCode(admin.id, form);
  if (problem) return { error: problem };

  // This browser stays signed in to set the new app up. Every other one is signed out.
  await resetEnrolment(admin.id, await currentSessionHash());
  redirect(ENROL_PATH);
}
