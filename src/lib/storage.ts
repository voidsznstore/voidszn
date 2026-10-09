import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Product photo storage (Cloudflare R2, which speaks the S3 protocol).
 *
 * Needs R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY, R2_SECRET_KEY and
 * R2_PUBLIC_URL. Requests are signed here with the standard S3 scheme
 * (AWS Signature Version 4), so no extra library is needed.
 */

type Config = {
  endpoint: URL;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicUrl: string;
};

function readConfig(): Config | null {
  const { R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY, R2_SECRET_KEY, R2_PUBLIC_URL } = process.env;
  if (!R2_ENDPOINT || !R2_BUCKET_NAME || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL) {
    return null;
  }
  try {
    return {
      endpoint: new URL(R2_ENDPOINT),
      bucket: R2_BUCKET_NAME,
      accessKey: R2_ACCESS_KEY,
      secretKey: R2_SECRET_KEY,
      publicUrl: R2_PUBLIC_URL.replace(/\/+$/, ""),
    };
  } catch {
    return null;
  }
}

export function isStorageConfigured(): boolean {
  return readConfig() !== null;
}

/** The public address photos are served from, e.g. https://img.voidszn.com. */
export function storagePublicUrl(): string | null {
  return readConfig()?.publicUrl ?? null;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** Encodes one path segment the way S3 expects. */
const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export type SignInput = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region: string;
  /** e.g. 20130524T000000Z */
  amzDate: string;
};

/**
 * Builds the Authorization header for a request. Exported so it can be checked
 * against Amazon's published example.
 */
export function signRequest(input: SignInput): string {
  const date = input.amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value.trim()]),
    ),
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
  };
  const names = Object.keys(headers).sort();

  const query = [...input.url.searchParams.entries()]
    .map(([name, value]) => `${encodeSegment(name)}=${encodeSegment(value)}`)
    .sort()
    .join("&");

  const canonicalRequest = [
    input.method,
    input.url.pathname,
    query,
    ...names.map((name) => `${name}:${headers[name]}`),
    "",
    names.join(";"),
    input.payloadHash,
  ].join("\n");

  const scope = `${date}/${input.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, date), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

async function send(
  config: Config,
  method: "PUT" | "DELETE" | "HEAD" | "GET",
  key: string,
  options: { body?: Uint8Array; headers?: Record<string, string>; query?: string } = {},
): Promise<Response> {
  // The endpoint is the account address. Objects live under /<bucket>/<key>.
  const base = config.endpoint.pathname.replace(/\/+$/, "");
  const inBucket = base.endsWith(`/${config.bucket}`) ? base : `${base}/${config.bucket}`;
  const path = key ? `${inBucket}/${key.split("/").map(encodeSegment).join("/")}` : inBucket;
  const url = new URL(`${config.endpoint.origin}${path}${options.query ? `?${options.query}` : ""}`);

  const payloadHash = sha256(options.body ?? "");
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const headers = options.headers ?? {};
  const authorization = signRequest({
    method,
    url,
    headers,
    payloadHash,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: "auto",
    amzDate,
  });

  return fetch(url, {
    method,
    headers: {
      ...headers,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body: options.body ? Buffer.from(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
}

/** Stores a file and returns the public address it can be loaded from. */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const config = readConfig();
  if (!config) throw new Error("Photo storage is not configured.");

  const response = await send(config, "PUT", key, {
    body,
    headers: {
      "Content-Type": contentType,
      // File names are random and never reused, so browsers can keep them for good.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  if (!response.ok) throw new Error(`Photo storage refused the upload (${response.status}).`);
  return `${config.publicUrl}/${key}`;
}

/** Removes a stored file given its public address. Quietly does nothing if it isn't ours. */
export async function deleteObjectByUrl(publicUrl: string): Promise<void> {
  const config = readConfig();
  if (!config || !publicUrl.startsWith(`${config.publicUrl}/`)) return;
  const key = publicUrl.slice(config.publicUrl.length + 1);
  const response = await send(config, "DELETE", key);
  if (!response.ok && response.status !== 404) {
    throw new Error(`Photo storage refused the delete (${response.status}).`);
  }
}

/** Whether the bucket can be reached with the saved keys. For the health check. */
export async function checkStorage(): Promise<string> {
  const config = readConfig();
  if (!config) return "not configured";
  try {
    const response = await send(config, "GET", "", { query: "list-type=2&max-keys=1" });
    return response.ok ? "ok" : `error: ${response.status}`;
  } catch {
    return "error: could not reach storage";
  }
}
