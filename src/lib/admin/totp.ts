import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticator app codes (the standard Google Authenticator uses: TOTP, RFC 6238,
 * with SHA-1, six digits and a new code every 30 seconds). No library needed: a
 * code is an HMAC of the current 30-second window, keyed by a shared secret.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of text.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random secret, in the form authenticator apps accept. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Which 30-second window a moment falls in. */
export const stepAt = (milliseconds: number) => Math.floor(milliseconds / 1000 / STEP_SECONDS);

/** The code for one 30-second window. */
export function codeForStep(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** digits).padStart(digits, "0");
}

/**
 * Checks a code. Accepts the current window and one either side, so a slightly
 * slow or fast phone clock still works. Returns the window the code belongs to,
 * or null when it is wrong.
 *
 * `afterStep` is the window of the last code accepted: anything at or before it
 * is refused, so a code that was just used can't be used again.
 */
export function verifyCode(
  secret: string,
  code: string,
  now: number,
  afterStep: number | null = null,
): number | null {
  const given = Buffer.from(code.replace(/\s/g, ""));
  if (given.length !== DIGITS) return null;

  const current = stepAt(now);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(codeForStep(secret, step));
    // Check every window even after a match, so timing doesn't hint at which one.
    if (timingSafeEqual(given, expected) && (afterStep === null || step > afterStep)) {
      matched ??= step;
    }
  }
  return matched;
}

/** The address a QR code encodes so an authenticator app can add the account. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query}`;
}

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

// No 0, O, 1 or I, so a code copied by hand can't be misread.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const RECOVERY_CODE_COUNT = 10;

/** A one-time code like "K7MQ-2XWP-9RTD", for when the phone is not to hand. */
export function newRecoveryCode(): string {
  const bytes = randomBytes(12);
  const letters = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
  return [letters.slice(0, 4), letters.slice(4, 8), letters.slice(8, 12)]
    .map((group) => group.join(""))
    .join("-");
}

/** Recovery codes are compared without dashes, spaces or regard to case. */
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const looksLikeRecoveryCode = (code: string) => normalizeRecoveryCode(code).length === 12;
