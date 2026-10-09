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
import { createSession, destroySession } from "@/lib/admin/session";
import { SETUP_SETTING, isSetupCodeValid } from "@/lib/admin/setup";
import {
  LOCKOUT_MESSAGE,
  attemptKeys,
  clearFailures,
  isLockedOut,
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
    .select({ id: adminUsers.id, passwordHash: adminUsers.passwordHash })
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
  await createSession(admin.id);
  redirect("/admin");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/admin/login");
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
