import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminInvites, adminSessions, adminUsers } from "@/db/schema";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { adminInviteEmail } from "@/lib/email/templates";
import { siteConfig } from "@/lib/site-config";
import { hashPassword } from "./passwords";

/**
 * Inviting someone to the admin. Their account is made straight away with a
 * password nobody can type, and they are emailed a link to set a real one. The
 * link works once, for a week, and only its hash is stored. After that they set
 * up their authenticator app like everyone else.
 */

/** Stored in place of a password hash until the invitation is accepted. It can never match a typed password. */
export const INVITED_PASSWORD = "!invited";
export const INVITE_DAYS = 7;

/** A problem the person using the admin can fix. Shown to them as written. */
export class InviteError extends Error {}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Makes the account and its invitation. The email is sent separately. */
export async function createInvite(input: { name: string; email: string }, invitedBy: string): Promise<string> {
  const email = input.email.trim().toLowerCase();
  return getDb().transaction(async (tx) => {
    const [admin] = await tx
      .insert(adminUsers)
      .values({ email, name: input.name.trim(), passwordHash: INVITED_PASSWORD, role: "STAFF" })
      .onConflictDoNothing({ target: adminUsers.email })
      .returning({ id: adminUsers.id });
    if (!admin) throw new InviteError("That email already has an account.");
    await tx.insert(adminInvites).values({ adminId: admin.id, invitedBy });
    return admin.id;
  });
}

/**
 * Emails a fresh link for an invitation that hasn't been accepted. Any earlier
 * link stops working. Returns false if the email couldn't be sent, in which
 * case the invitation goes back to waiting and the next run tries again.
 */
export async function sendInvite(adminId: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const db = getDb();
  const [row] = await db
    .select({
      inviteId: adminInvites.id,
      invitedBy: adminInvites.invitedBy,
      name: adminUsers.name,
      email: adminUsers.email,
    })
    .from(adminInvites)
    .innerJoin(adminUsers, eq(adminUsers.id, adminInvites.adminId))
    .where(
      and(
        eq(adminInvites.adminId, adminId),
        isNull(adminInvites.acceptedAt),
        isNull(adminUsers.disabledAt),
        eq(adminUsers.passwordHash, INVITED_PASSWORD),
      ),
    )
    .limit(1);
  if (!row) return false;

  const token = randomBytes(32).toString("base64url");
  await db
    .update(adminInvites)
    .set({
      tokenHash: hash(token),
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    })
    .where(eq(adminInvites.id, row.inviteId));

  const result = await sendEmail({
    to: row.email,
    ...adminInviteEmail({
      name: row.name,
      invitedBy: row.invitedBy,
      // Always the store's own address, never one taken from the request.
      url: `${siteConfig.url}/admin/join?code=${token}`,
      days: INVITE_DAYS,
    }),
    idempotencyKey: `admin-invite/${hash(token).slice(0, 32)}`,
  });
  if (!result.ok) {
    console.error(`[invites] Could not email an invitation: ${result.reason}`);
    await db
      .update(adminInvites)
      .set({ tokenHash: null, sentAt: null, expiresAt: null })
      .where(eq(adminInvites.id, row.inviteId));
    return false;
  }
  return true;
}

/** Sends every invitation that is still waiting for its email. Safe to call as often as you like. */
export async function sendPendingInvites(): Promise<number> {
  if (!isEmailConfigured()) return 0;
  const waiting = await getDb()
    .select({ adminId: adminInvites.adminId })
    .from(adminInvites)
    .where(and(isNull(adminInvites.sentAt), isNull(adminInvites.acceptedAt)))
    .orderBy(asc(adminInvites.createdAt))
    .limit(10);
  let sent = 0;
  for (const invite of waiting) {
    if (await sendInvite(invite.adminId)) sent += 1;
  }
  return sent;
}

const live = (token: string) =>
  and(
    eq(adminInvites.tokenHash, hash(token)),
    isNull(adminInvites.acceptedAt),
    isNotNull(adminInvites.expiresAt),
    gt(adminInvites.expiresAt, new Date()),
  );

const looksLikeToken = (token: unknown): token is string =>
  typeof token === "string" && token.length >= 20 && token.length <= 100;

/** Who an invitation link is for, or null if it is no longer good. */
export async function readInvite(token: unknown): Promise<{ name: string; email: string } | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await getDb()
    .select({ name: adminUsers.name, email: adminUsers.email })
    .from(adminInvites)
    .innerJoin(adminUsers, eq(adminUsers.id, adminInvites.adminId))
    .where(and(live(token), isNull(adminUsers.disabledAt), eq(adminUsers.passwordHash, INVITED_PASSWORD)))
    .limit(1);
  return row ?? null;
}

/**
 * Sets the name and password from an invitation link. Returns the account's id,
 * or null if the link is no longer good. Only the request that marks the link as
 * used goes on to set the password, so it can't be used twice.
 */
export async function acceptInvite(token: string, name: string, password: string): Promise<string | null> {
  if (!looksLikeToken(token)) return null;
  const passwordHash = await hashPassword(password);
  return getDb().transaction(async (tx) => {
    const [used] = await tx
      .update(adminInvites)
      .set({ acceptedAt: new Date(), tokenHash: null })
      .where(live(token))
      .returning({ adminId: adminInvites.adminId });
    if (!used) return null;

    const [admin] = await tx
      .update(adminUsers)
      .set({ name: name.trim(), passwordHash })
      .where(
        and(
          eq(adminUsers.id, used.adminId),
          eq(adminUsers.passwordHash, INVITED_PASSWORD),
          isNull(adminUsers.disabledAt),
        ),
      )
      .returning({ id: adminUsers.id });
    if (!admin) {
      // Undo the claim: the account was removed or already has a password.
      throw new Rollback();
    }
    await tx.delete(adminSessions).where(eq(adminSessions.adminId, admin.id));
    return admin.id;
  }).catch((error) => {
    if (error instanceof Rollback) return null;
    throw error;
  });
}

class Rollback extends Error {}
