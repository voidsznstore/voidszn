/**
 * Checks the request signing used for photo storage against the two worked
 * examples Amazon publishes for the S3 protocol. If these signatures match,
 * the signing is right.
 *
 *   npm run test:storage
 */
import assert from "node:assert/strict";
import { signRequest } from "../src/lib/storage";

const common = {
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  amzDate: "20130524T000000Z",
};
const EMPTY_BODY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const getObject = signRequest({
  ...common,
  method: "GET",
  url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
  headers: { Range: "bytes=0-9" },
  payloadHash: EMPTY_BODY,
});
assert.match(
  getObject,
  /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/,
);
console.log("  ok  reading a file matches Amazon's example");

const listObjects = signRequest({
  ...common,
  method: "GET",
  url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
  headers: {},
  payloadHash: EMPTY_BODY,
});
assert.match(
  listObjects,
  /Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/,
);
console.log("  ok  listing a bucket matches Amazon's example");
console.log("\n2 checks passed");
