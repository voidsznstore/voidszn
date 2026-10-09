import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { adminPasswordResets, adminSessions, adminUsers } from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { passwordResetEmail } from "@/lib/email/templates";
import { siteConfig } from "@/lib/site-config";
import { hashPassword } from "./passwords";

/**
 * "Forgot my password". A link is emailed to the account's address; the database
 * holds only the hash of the code in it. The link works once and for an hour.
 * Resetting the password does not get around the authenticator app.
 */

export const RESET_MINUTES = 60;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Emails a reset link if the address belongs to an admin. Says nothing either way. */
export async function requestPasswordReset(email: string): Promise<void> {
  const db = getDb();
  const [admin] = await db
    .select({ id: adminUsers.id, name: adminUsers.name, email: adminUsers.email })
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);
  if (!admin) return;

  const token = randomBytes(32).toString("base64url");
  await db.delete(adminPasswordResets).where(lt(adminPasswordResets.expiresAt, new Date()));
  await db.insert(adminPasswordResets).values({
    adminId: admin.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
  });

  // Always the store's own address, never one taken from the request.
  const url = `${siteConfig.url}/admin/reset?token=${token}`;
  await sendEmail({
    to: admin.email,
    ...passwordResetEmail({ name: admin.name, url, minutes: RESET_MINUTES }),
    idempotencyKey: `password-reset/${hash(token).slice(0, 32)}`,
  });
}

const live = (token: string) =>
  and(
    eq(adminPasswordResets.tokenHash, hash(token)),
    isNull(adminPasswordResets.usedAt),
    gt(adminPasswordResets.expiresAt, new Date()),
  );

export async function isResetTokenValid(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return false;
  const [row] = await getDb()
    .select({ id: adminPasswordResets.id })
    .from(adminPasswordResets)
    .where(live(token))
    .limit(1);
  return Boolean(row);
}

/**
 * Sets a new password using a reset link. Signs the account out everywhere and
 * cancels any other reset links. Returns false if the link is no longer good.
 */
export async function resetPassword(token: string, password: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return getDb().transaction(async (tx) => {
    // Only the request that marks the link as used goes on to change the password.
    const [used] = await tx
      .update(adminPasswordResets)
      .set({ usedAt: new Date() })
      .where(live(token))
      .returning({ adminId: adminPasswordResets.adminId });
    if (!used) return false;

    await tx.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, used.adminId));
    await tx.delete(adminSessions).where(eq(adminSessions.adminId, used.adminId));
    await tx
      .delete(adminPasswordResets)
      .where(and(eq(adminPasswordResets.adminId, used.adminId), isNull(adminPasswordResets.usedAt)));
    return true;
  });
}
