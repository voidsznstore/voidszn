import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { getSetting } from "@/db/queries/settings";
import { adminUsers } from "@/db/schema";

/**
 * First-time setup. The owner gets a one-time link; the database holds only the
 * hash of the code in it. The link works while no admin exists and it hasn't
 * expired. Creating the first admin removes it.
 */
export const SETUP_SETTING = "admin.setup";

export async function isSetupCodeValid(code: unknown): Promise<boolean> {
  if (typeof code !== "string" || code.length < 20 || code.length > 100) return false;

  const db = getDb();
  const saved = await getSetting(db, SETUP_SETTING);
  if (!saved) return false;

  let setup: { hash?: string; expiresAt?: string };
  try {
    setup = JSON.parse(saved) as typeof setup;
  } catch {
    return false;
  }
  if (!setup.hash || !setup.expiresAt || new Date(setup.expiresAt).getTime() < Date.now()) {
    return false;
  }

  const given = createHash("sha256").update(code).digest();
  const expected = Buffer.from(setup.hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;

  const [{ admins }] = await db.select({ admins: count() }).from(adminUsers);
  return admins === 0;
}
