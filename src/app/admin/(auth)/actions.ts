"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { adminUsers, storeSettings } from "@/db/schema";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  decoyHash,
  hashPassword,
  verifyPassword,
} from "@/lib/admin/passwords";
import { requestPasswordReset, resetPassword } from "@/lib/admin/password-reset";
import { createSession, destroySession, requireSignedIn } from "@/lib/admin/session";
import { SETUP_SETTING, isSetupCodeValid } from "@/lib/admin/setup";
import { isEmailConfigured } from "@/lib/email/send";
import {
  checkSecondStep,
  confirmEnrolment,
  endChallenge,
  failChallenge,
  readChallenge,
  recordGuess,
  startChallenge,
  tooManyGuesses,
} from "@/lib/admin/two-step";
import {
  LOCKOUT_MESSAGE,
  attemptKeys,
  clearFailures,
  clientAddress,
  countAgainst,
  isLockedOut,
  isOverLimit,
  recordFailure,
} from "@/lib/admin/throttle";

export type AuthFormState = { error?: string; values?: { email?: string; name?: string } };

const email = z.string().trim().toLowerCase().email().max(254);

const signInSchema = z.object({
  email,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export async function signIn(_previous: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  const typedEmail = typeof form.get("email") === "string" ? String(form.get("email")) : "";
  // The same message whether the email or the password is wrong.
  const wrong: AuthFormState = {
    error: "That email and password don't match.",
    values: { email: typedEmail },
  };
  if (!parsed.success) return wrong;

  const keys = await attemptKeys(parsed.data.email);
  if (await isLockedOut(keys)) return { error: LOCKOUT_MESSAGE, values: { email: typedEmail } };

  const [admin] = await getDb()
    .select({
      id: adminUsers.id,
      passwordHash: adminUsers.passwordHash,
      totpEnabledAt: adminUsers.totpEnabledAt,
    })
    .from(adminUsers)
    .where(eq(adminUsers.email, parsed.data.email))
    .limit(1);

  const matches = await verifyPassword(
    parsed.data.password,
    admin?.passwordHash ?? (await decoyHash()),
  );
  if (!admin || !matches) {
    await recordFailure(keys);
    return wrong;
  }

  await clearFailures(keys);

  // With an authenticator app set up, the password is only half of signing in.
  if (admin.totpEnabledAt) {
    await startChallenge(admin.id);
    redirect("/admin/login/verify");
  }
  // Otherwise sign in, and the admin sends them to set the app up before anything else.
  await createSession(admin.id);
  redirect("/admin");
}

export type CodeFormState = { error?: string };

/** Second step of signing in: a code from the authenticator app, or a recovery code. */
export async function verifySecondStep(
  _previous: CodeFormState,
  form: FormData,
): Promise<CodeFormState> {
  const challenge = await readChallenge();
  if (!challenge) {
    await endChallenge();
    redirect("/admin/login?expired=1");
  }

  const code = z.string().trim().min(6).max(20).safeParse(form.get("code"));
  const result = code.success
    ? await checkSecondStep(challenge.adminId, code.data)
    : ({ ok: false } as const);

  if (!result.ok) {
    const left = await failChallenge(challenge);
    if (left <= 0) {
      await endChallenge(challenge);
      redirect("/admin/login?expired=1");
    }
    return { error: `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` };
  }

  await endChallenge(challenge, { everyAttempt: true });
  await createSession(challenge.adminId);
  redirect(result.usedRecoveryCode ? "/admin/security?recovery=1" : "/admin");
}

export type EnrolFormState = { error?: string; recoveryCodes?: string[] };

/** Finishes setting up the authenticator app, by proving it shows the right code. */
export async function confirmAuthenticator(
  _previous: EnrolFormState,
  form: FormData,
): Promise<EnrolFormState> {
  const admin = await requireSignedIn();
  if (admin.twoStep) redirect("/admin");
  if (await tooManyGuesses(admin.id)) return { error: LOCKOUT_MESSAGE };

  const code = z.string().trim().min(6).max(10).safeParse(form.get("code"));
  const recoveryCodes = code.success ? await confirmEnrolment(admin.id, code.data) : null;
  if (!recoveryCodes) {
    await recordGuess(admin.id);
    return { error: "That code isn't right. Check the app and enter the six digits it shows now." };
  }
  return { recoveryCodes };
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/admin/login");
}

/** Ends the session and stays put. The sign-out button then reloads the browser itself. */
export async function endSession(): Promise<void> {
  await destroySession();
}

const setupSchema = z.object({
  code: z.string().min(20).max(100),
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: email,
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(MAX_PASSWORD_LENGTH),
  confirm: z.string(),
});

export async function createOwner(_previous: AuthFormState, form: FormData): Promise<AuthFormState> {
  const text = (name: string) => (typeof form.get(name) === "string" ? String(form.get(name)) : "");
  const values = { email: text("email"), name: text("name") };

  const parsed = setupSchema.safeParse({
    code: form.get("code"),
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message =
      issue?.path[0] === "email"
        ? "Enter a valid email address."
        : issue?.path[0] === "code"
          ? "This setup link is no longer valid."
          : (issue?.message ?? "Check the form and try again.");
    return { error: message, values };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "The two passwords don't match.", values };
  }
  if (!(await isSetupCodeValid(parsed.data.code))) {
    return { error: "This setup link is no longer valid.", values };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const adminId = await getDb().transaction(async (tx) => {
    // Removing the link first means two people can't both use it: only the
    // request that actually deletes it goes on to create the account.
    const removed = await tx
      .delete(storeSettings)
      .where(eq(storeSettings.key, SETUP_SETTING))
      .returning({ key: storeSettings.key });
    if (removed.length === 0) return null;

    const [admin] = await tx
      .insert(adminUsers)
      .values({
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash,
        role: "OWNER",
      })
      .returning({ id: adminUsers.id });
    return admin.id;
  });
  if (!adminId) return { error: "This setup link is no longer valid.", values };

  await createSession(adminId);
  redirect("/admin");
}

export type ResetRequestState = { error?: string; sent?: boolean };

/** "Forgot my password": emails a reset link. The answer is the same whether or not the address has an account. */
export async function requestReset(
  _previous: ResetRequestState,
  form: FormData,
): Promise<ResetRequestState> {
  if (!isEmailConfigured()) {
    return { error: "Password reset by email isn't set up yet." };
  }
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const key = `reset:${await clientAddress()}`;
  if (await isOverLimit(key, 5)) return { error: LOCKOUT_MESSAGE };
  await countAgainst(key);

  await requestPasswordReset(parsed.data);
  return { sent: true };
}

/** Sets a new password from a reset link. */
export async function chooseNewPassword(
  _previous: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const parsed = z
    .object({
      token: z.string().min(20).max(100),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
        .max(MAX_PASSWORD_LENGTH),
      confirm: z.string(),
    })
    .safeParse({
      token: form.get("token"),
      password: form.get("password"),
      confirm: form.get("confirm"),
    });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue?.path[0] === "token" ? "This reset link is no longer valid." : issue?.message,
    };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "The two passwords don't match." };
  }
  if (!(await resetPassword(parsed.data.token, parsed.data.password))) {
    return { error: "This reset link is no longer valid. Ask for a new one." };
  }
  redirect("/admin/login?reset=1");
}
