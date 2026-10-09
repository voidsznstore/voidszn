/**
 * Checks authenticator codes against the published examples in the standard
 * (RFC 6238, appendix B), which is what Google Authenticator implements.
 *
 *   npm run test:totp
 */
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  codeForStep,
  newRecoveryCode,
  newSecret,
  normalizeRecoveryCode,
  otpauthUri,
  stepAt,
  verifyCode,
} from "../src/lib/admin/totp";

let passed = 0;
function check(label: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ok  ${label}`);
}

// The standard's test secret is the ASCII text "12345678901234567890".
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

check("codes match the standard's published examples", () => {
  const examples: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, expected] of examples) {
    assert.equal(codeForStep(SECRET, stepAt(seconds * 1000), 8), expected);
    // The six-digit code apps show is the last six of the eight-digit one.
    assert.equal(codeForStep(SECRET, stepAt(seconds * 1000)), expected.slice(2));
  }
});

check("base32 round-trips, and matches a known value", () => {
  assert.equal(SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode(SECRET).toString(), "12345678901234567890");
  const secret = newSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Encode(base32Decode(secret)), secret);
});

const NOW = 1234567890 * 1000;
const step = stepAt(NOW);

check("the current code, the one before and the one after are accepted", () => {
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step), NOW), step);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step - 1), NOW), step - 1);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step + 1), NOW), step + 1);
  assert.equal(verifyCode(SECRET, "005 924", NOW), step);
});

check("older codes, wrong codes and malformed codes are refused", () => {
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step - 2), NOW), null);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step + 2), NOW), null);
  assert.equal(verifyCode(SECRET, "000000", NOW), null);
  assert.equal(verifyCode(SECRET, "12345", NOW), null);
  assert.equal(verifyCode(SECRET, "1234567", NOW), null);
  assert.equal(verifyCode(SECRET, "abcdef", NOW), null);
  assert.equal(verifyCode(newSecret(), codeForStep(SECRET, step), NOW), null);
});

check("a code can't be used twice", () => {
  const code = codeForStep(SECRET, step);
  assert.equal(verifyCode(SECRET, code, NOW, step), null);
  assert.equal(verifyCode(SECRET, code, NOW, step - 1), step);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step - 1), NOW, step), null);
});

check("the QR code address has what authenticator apps expect", () => {
  const uri = new URL(otpauthUri(SECRET, "owner@example.com", "VOIDSZN"));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.host, "totp");
  assert.equal(decodeURIComponent(uri.pathname), "/VOIDSZN:owner@example.com");
  assert.equal(uri.searchParams.get("secret"), SECRET);
  assert.equal(uri.searchParams.get("issuer"), "VOIDSZN");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
});

check("recovery codes are readable and compared loosely", () => {
  const code = newRecoveryCode();
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeRecoveryCode(` ${code.toLowerCase().replaceAll("-", " ")} `), code.replaceAll("-", ""));
  assert.notEqual(newRecoveryCode(), newRecoveryCode());
});

console.log(`\n${passed} checks passed`);
