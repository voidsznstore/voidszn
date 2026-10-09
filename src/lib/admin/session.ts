import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { ADMIN_COOKIE } from "./cookie";

/**
 * Admin sessions. The browser holds a random token in a cookie that scripts can't
 * read. The database holds only the token's hash, so a copy of the database can't
 * be used to sign in. Signing out deletes the row, which ends the session for real.
 */

const SESSION_DAYS = 14;

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "STAFF";
  /** Whether an authenticator app has been set up. The admin is closed until it has. */
  twoStep: boolean;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(adminId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = getDb();

  await db.insert(adminSessions).values({ adminId, tokenHash: hashToken(token), expiresAt });
  // Tidy up while we're here.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));

  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (token) {
    await getDb().delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
  }
  store.delete(ADMIN_COOKIE);
}

/** Ends every session for an admin, e.g. after a password change. */
export async function destroyAllSessions(adminId: string): Promise<void> {
  await getDb().delete(adminSessions).where(eq(adminSessions.adminId, adminId));
}

/** The signed-in admin, or null. Checked against the database on every request. */
export const getAdmin = cache(async (): Promise<Admin | null> => {
  // Admin screens are only ever built for a real visit, never ahead of time.
  await connection();

  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || token.length > 100) return null;

  const [row] = await getDb()
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      totpEnabledAt: adminUsers.totpEnabledAt,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(
      and(
        eq(adminSessions.tokenHash, hashToken(token)),
        gt(adminSessions.expiresAt, new Date()),
        // Someone whose access was taken away is signed out at once, everywhere.
        isNull(adminUsers.disabledAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  const { totpEnabledAt, ...admin } = row;
  return { ...admin, twoStep: totpEnabledAt !== null };
});

/** The hash of this browser's session token, for "sign out everywhere else". */
export async function currentSessionHash(): Promise<string | undefined> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return token ? hashToken(token) : undefined;
}

/** Where an admin who hasn't set up their authenticator app yet is sent. */
export const ENROL_PATH = "/admin/security/authenticator";

/**
 * For the authenticator set-up screen only: signed in with a password, whether or
 * not the app is set up yet. Everything else uses `requireAdmin`.
 */
export async function requireSignedIn(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/**
 * Use at the top of every admin page and every admin action. Sends anyone who
 * isn't signed in to the sign-in page, and anyone who hasn't set up their
 * authenticator app to do that first.
 */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (!admin.twoStep) redirect(ENROL_PATH);
  return admin;
}

/**
 * The master account is the owner's: the one account that can change how the
 * profit is split, correct payouts, and add or remove people. Everything else in
 * the admin is the same for everyone.
 */
export const isMaster = (admin: Pick<Admin, "role">) => admin.role === "OWNER";

/** For pages and actions only the master account may use. Everyone else is sent to the overview. */
export async function requireMaster(): Promise<Admin> {
  const admin = await requireAdmin();
  if (!isMaster(admin)) redirect("/admin");
  return admin;
}
