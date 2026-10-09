import { and, asc, eq, ne } from "drizzle-orm";
import type { Database } from "../index";
import { adminInvites, adminSessions, adminUsers } from "../schema";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  isMaster: boolean;
  /** Has set a password from their invitation (or is the first account). */
  joined: boolean;
  /** Has set up their authenticator app, so they can actually get in. */
  twoStep: boolean;
  disabled: boolean;
  invite: { sentAt: Date | null; expired: boolean; invitedBy: string } | null;
  createdAt: Date;
};

export async function listTeam(db: Database): Promise<TeamMember[]> {
  const rows = await db
    .select({
      id: adminUsers.id,
      name: adminUsers.name,
      email: adminUsers.email,
      role: adminUsers.role,
      passwordHash: adminUsers.passwordHash,
      totpEnabledAt: adminUsers.totpEnabledAt,
      disabledAt: adminUsers.disabledAt,
      createdAt: adminUsers.createdAt,
      inviteSentAt: adminInvites.sentAt,
      inviteExpiresAt: adminInvites.expiresAt,
      inviteAcceptedAt: adminInvites.acceptedAt,
      invitedBy: adminInvites.invitedBy,
    })
    .from(adminUsers)
    .leftJoin(adminInvites, eq(adminInvites.adminId, adminUsers.id))
    .orderBy(asc(adminUsers.createdAt));

  const now = Date.now();
  return rows.map((row) => {
    const joined = !row.passwordHash.startsWith("!");
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      isMaster: row.role === "OWNER",
      joined,
      twoStep: row.totpEnabledAt !== null,
      disabled: row.disabledAt !== null,
      invite:
        !joined && row.invitedBy
          ? {
              sentAt: row.inviteSentAt,
              expired: row.inviteExpiresAt !== null && row.inviteExpiresAt.getTime() < now,
              invitedBy: row.invitedBy,
            }
          : null,
      createdAt: row.createdAt,
    };
  });
}

/**
 * Takes someone's access away, or gives it back. Taking it away signs them out
 * everywhere at once. The master account can't be shut out this way.
 */
export async function setAccess(db: Database, adminId: string, allowed: boolean): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [changed] = await tx
      .update(adminUsers)
      .set({ disabledAt: allowed ? null : new Date() })
      .where(and(eq(adminUsers.id, adminId), ne(adminUsers.role, "OWNER")))
      .returning({ id: adminUsers.id });
    if (!changed) return false;
    if (!allowed) await tx.delete(adminSessions).where(eq(adminSessions.adminId, adminId));
    return true;
  });
}
