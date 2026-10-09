import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt, which is built into Node. Stored as
 * `scrypt$N$r$p$salt$hash` so the cost can be raised later without breaking
 * existing passwords.
 */
const COST = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 32;
const MAX_MEMORY = 128 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;
// scrypt handles long input, but there is no reason to hash a megabyte.
export const MAX_PASSWORD_LENGTH = 200;

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join(
    "$",
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every((value) => Number.isInteger(value) && value > 0)) return false;

  const expected = Buffer.from(hash, "base64");
  try {
    const actual = await derive(password, Buffer.from(salt, "base64"), cost);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A real hash of a throwaway password. Checking a sign-in against this when the
 * email doesn't exist takes as long as a real check, so response time doesn't
 * reveal which emails have accounts.
 */
let decoy: Promise<string> | null = null;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString("base64"));
  return decoy;
}
