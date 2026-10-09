import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import QRCode from "qrcode";
import { getDb } from "@/db";
import {
  adminLoginAttempts,
  adminLoginChallenges,
  adminRecoveryCodes,
  adminSessions,
  adminUsers,
} from "@/db/schema";
import { siteConfig } from "@/lib/site-config";
import { CHALLENGE_COOKIE } from "./cookie";
import {
  RECOVERY_CODE_COUNT,
  looksLikeRecoveryCode,
  newRecoveryCode,
  newSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyCode,
} from "./totp";

/**
 * Two-step sign-in: a password, then a code from an authenticator app (Google
 * Authenticator or any other). Recovery codes stand in for the app when the phone
 * is not to hand; each works once.
 */

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/* ------------------------------------------------------------------ */
/* The step between password and code                                  */
/* ------------------------------------------------------------------ */

const CHALLENGE_MINUTES = 10;
const MAX_CHALLENGE_ATTEMPTS = 5;

/** Called once the password is right. Remembers who is half signed in, for ten minutes. */
export async function startChallenge(adminId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60 * 1000);
  const db = getDb();
  await db.insert(adminLoginChallenges).values({ adminId, tokenHash: hash(token), expiresAt });
  await db.delete(adminLoginChallenges).where(lt(adminLoginChallenges.expiresAt, new Date()));

  (await cookies()).set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/admin",
    expires: expiresAt,
  });
}

export type Challenge = { id: string; adminId: string; attemptsLeft: number };

/** Who is half signed in on this browser, if anyone. */
export async function readChallenge(): Promise<Challenge | null> {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!token || token.length > 100) return null;

  const [row] = await getDb()
    .select({
      id: adminLoginChallenges.id,
      adminId: adminLoginChallenges.adminId,
      attempts: adminLoginChallenges.attempts,
    })
    .from(adminLoginChallenges)
    .where(
      and(
        eq(adminLoginChallenges.tokenHash, hash(token)),
        gt(adminLoginChallenges.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row || row.attempts >= MAX_CHALLENGE_ATTEMPTS) return null;
  return { id: row.id, adminId: row.adminId, attemptsLeft: MAX_CHALLENGE_ATTEMPTS - row.attempts };
}

/** Counts a wrong code. Returns how many tries are left before starting over. */
export async function failChallenge(challenge: Challenge): Promise<number> {
  await getDb()
    .update(adminLoginChallenges)
    .set({ attempts: sql`${adminLoginChallenges.attempts} + 1` })
    .where(eq(adminLoginChallenges.id, challenge.id));
  return challenge.attemptsLeft - 1;
}

/**
 * Ends a half-finished sign-in. After a successful one, pass `everyAttempt` to
 * also end any others still open for the same admin.
 */
export async function endChallenge(
  challenge?: Challenge | null,
  options: { everyAttempt?: boolean } = {},
): Promise<void> {
  if (challenge) {
    await getDb()
      .delete(adminLoginChallenges)
      .where(
        options.everyAttempt
          ? eq(adminLoginChallenges.adminId, challenge.adminId)
          : eq(adminLoginChallenges.id, challenge.id),
      );
  }
  (await cookies()).delete({ name: CHALLENGE_COOKIE, path: "/admin" });
}

/* ------------------------------------------------------------------ */
/* Checking a code                                                     */
/* ------------------------------------------------------------------ */

export type SecondStep = { ok: true; usedRecoveryCode: boolean } | { ok: false };

/**
 * Checks what was typed at the second step: a six-digit authenticator code, or a
 * recovery code. Each can only be used once.
 */
export async function checkSecondStep(adminId: string, input: string): Promise<SecondStep> {
  const db = getDb();

  if (looksLikeRecoveryCode(input)) {
    const used = await db
      .update(adminRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(adminRecoveryCodes.adminId, adminId),
          eq(adminRecoveryCodes.codeHash, hash(normalizeRecoveryCode(input))),
          isNull(adminRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: adminRecoveryCodes.id });
    return used.length === 1 ? { ok: true, usedRecoveryCode: true } : { ok: false };
  }

  const [admin] = await db
    .select({ secret: adminUsers.totpSecret, lastStep: adminUsers.totpLastStep })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminId))
    .limit(1);
  if (!admin?.secret) return { ok: false };

  const step = verifyCode(admin.secret, input, Date.now(), admin.lastStep);
  if (step === null) return { ok: false };

  // Only the first request to claim this code wins, so it can't be replayed.
  const claimed = await db
    .update(adminUsers)
    .set({ totpLastStep: step })
    .where(
      and(
        eq(adminUsers.id, adminId),
        or(isNull(adminUsers.totpLastStep), lt(adminUsers.totpLastStep, step)),
      ),
    )
    .returning({ id: adminUsers.id });
  return claimed.length === 1 ? { ok: true, usedRecoveryCode: false } : { ok: false };
}

/** Slows down guessing at the security screens, where there is no sign-in challenge to count against. */
const GUESS_LIMIT = 5;
const GUESS_WINDOW_MINUTES = 15;
const guessKey = (adminId: string) => `code:${adminId}`;

export async function tooManyGuesses(adminId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ failures: count() })
    .from(adminLoginAttempts)
    .where(
      and(
        eq(adminLoginAttempts.key, guessKey(adminId)),
        gt(adminLoginAttempts.createdAt, new Date(Date.now() - GUESS_WINDOW_MINUTES * 60 * 1000)),
      ),
    );
  return row.failures >= GUESS_LIMIT;
}

export async function recordGuess(adminId: string): Promise<void> {
  await getDb().insert(adminLoginAttempts).values({ key: guessKey(adminId) });
}

/* ------------------------------------------------------------------ */
/* Setting up the app                                                  */
/* ------------------------------------------------------------------ */

export type Enrolment = { secret: string; qrCode: string };

/**
 * The secret to add to the authenticator app, as a QR code and as text. The same
 * one is shown until it is confirmed, so reloading the page doesn't break a scan.
 */
export async function beginEnrolment(admin: { id: string; email: string }): Promise<Enrolment> {
  const db = getDb();
  const [row] = await db
    .select({ pending: adminUsers.totpPendingSecret })
    .from(adminUsers)
    .where(eq(adminUsers.id, admin.id))
    .limit(1);

  let secret = row?.pending;
  if (!secret) {
    secret = newSecret();
    await db.update(adminUsers).set({ totpPendingSecret: secret }).where(eq(adminUsers.id, admin.id));
  }

  const qrCode = await QRCode.toDataURL(otpauthUri(secret, admin.email, siteConfig.name), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 264,
  });
  return { secret, qrCode };
}

async function replaceRecoveryCodes(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  adminId: string,
): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));
  await tx
    .insert(adminRecoveryCodes)
    .values(codes.map((code) => ({ adminId, codeHash: hash(normalizeRecoveryCode(code)) })));
  return codes;
}

/**
 * Turns two-step sign-in on once a code from the app proves the scan worked.
 * Returns the recovery codes, which are shown this one time, or null if the code
 * was wrong.
 */
export async function confirmEnrolment(adminId: string, code: string): Promise<string[] | null> {
  return getDb().transaction(async (tx) => {
    const [admin] = await tx
      .select({ pending: adminUsers.totpPendingSecret })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1)
      .for("update");
    if (!admin?.pending) return null;

    const step = verifyCode(admin.pending, code, Date.now());
    if (step === null) return null;

    await tx
      .update(adminUsers)
      .set({
        totpSecret: admin.pending,
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
      })
      .where(eq(adminUsers.id, adminId));
    return replaceRecoveryCodes(tx, adminId);
  });
}

export async function regenerateRecoveryCodes(adminId: string): Promise<string[]> {
  return getDb().transaction((tx) => replaceRecoveryCodes(tx, adminId));
}

export async function countRecoveryCodes(adminId: string): Promise<number> {
  const [row] = await getDb()
    .select({ left: count() })
    .from(adminRecoveryCodes)
    .where(and(eq(adminRecoveryCodes.adminId, adminId), isNull(adminRecoveryCodes.usedAt)));
  return row.left;
}

/**
 * Removes the authenticator app from an account, so a new one can be set up (a
 * new phone, say). Every other signed-in browser is signed out.
 */
export async function resetEnrolment(adminId: string, keepSessionTokenHash?: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null })
      .where(eq(adminUsers.id, adminId));
    await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));
    await tx
      .delete(adminSessions)
      .where(
        and(
          eq(adminSessions.adminId, adminId),
          keepSessionTokenHash ? sql`${adminSessions.tokenHash} <> ${keepSessionTokenHash}` : undefined,
        ),
      );
  });
}
