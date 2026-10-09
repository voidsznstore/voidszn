"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from "@/lib/admin/passwords";
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

export type PasswordFormState = { error?: string; done?: boolean };

/** Changes the password from inside the admin. Needs the current one. */
export async function changePasswordAction(
  _previous: PasswordFormState,
  form: FormData,
): Promise<PasswordFormState> {
  const admin = await requireAdmin();
  if (await tooManyGuesses(admin.id)) return { error: LOCKOUT_MESSAGE };

  const parsed = z
    .object({
      current: z.string().min(1).max(MAX_PASSWORD_LENGTH),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
        .max(MAX_PASSWORD_LENGTH),
      confirm: z.string(),
    })
    .safeParse({
      current: form.get("current"),
      password: form.get("password"),
      confirm: form.get("confirm"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "The two new passwords don't match." };
  }

  const db = getDb();
  const [row] = await db
    .select({ passwordHash: adminUsers.passwordHash })
    .from(adminUsers)
    .where(eq(adminUsers.id, admin.id))
    .limit(1);
  if (!row || !(await verifyPassword(parsed.data.current, row.passwordHash))) {
    await recordGuess(admin.id);
    return { error: "Your current password isn't right." };
  }

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(adminUsers.id, admin.id));
  // Every other browser is signed out. This one stays in.
  const keep = await currentSessionHash();
  await db
    .delete(adminSessions)
    .where(
      and(eq(adminSessions.adminId, admin.id), keep ? ne(adminSessions.tokenHash, keep) : undefined),
    );
  return { done: true };
}
