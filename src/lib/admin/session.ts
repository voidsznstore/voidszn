import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
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

export type Admin = { id: string; email: string; name: string; role: "OWNER" | "STAFF" };

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
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(
      and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())),
    )
    .limit(1);

  return row ?? null;
});

/**
 * Use at the top of every admin page and every admin action. Sends anyone who
 * isn't signed in to the sign-in page.
 */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
