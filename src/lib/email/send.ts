import "server-only";
import { siteConfig } from "@/lib/site-config";

/**
 * Sends email through Resend. Needs RESEND_API_KEY and the store's domain
 * verified in Resend. Without the key nothing is sent and callers are told so,
 * which lets the rest of the store run before email is set up.
 */

const API = () => process.env.RESEND_API_URL ?? "https://api.resend.com";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * The same key always means the same email. If a send is retried with a key
   * that already went out, it is not sent twice.
   */
  idempotencyKey: string;
};

export type SendResult = { ok: true } | { ok: false; reason: string };

export async function sendEmail(email: Email): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "Email isn't set up yet." };

  try {
    const response = await fetch(`${API()}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: `${siteConfig.name} <${siteConfig.ordersEmail}>`,
        to: [email.to],
        reply_to: siteConfig.supportEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { ok: true };

    const body = (await response.json().catch(() => null)) as { name?: string } | null;
    console.error(`[email] Send failed (${response.status}${body?.name ? `: ${body.name}` : ""})`);
    return { ok: false, reason: `The email service refused it (${response.status}).` };
  } catch (error) {
    console.error("[email] Send failed", error);
    return { ok: false, reason: "The email service could not be reached." };
  }
}

/** One DNS record the email service needs on the store's domain. */
export type EmailDnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number;
  /** Whether the email service has seen this record yet. */
  found: boolean;
};

export type EmailStatus = {
  /** "ok" when email can go out from the store's own address. */
  status: string;
  /** While the domain isn't verified: the records to add where the domain's DNS is managed. */
  dns?: EmailDnsRecord[];
};

type Domain = {
  id: string;
  name?: string;
  status?: string;
  records?: {
    type?: string;
    name?: string;
    value?: string;
    priority?: number | string;
    status?: string;
  }[];
};

let cached: { value: EmailStatus; at: number } | null = null;
const OK_TTL_MS = 5 * 60_000;
// Checked more often while waiting, so a DNS change is picked up quickly.
const WAITING_TTL_MS = 30_000;

async function resend<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const response = await fetch(`${API()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => null)) as (T & { name?: string }) | null;
  return { ok: response.ok, status: response.status, data };
}

/**
 * For the health check: whether email can actually go out from the store's
 * domain. Also does the set-up that can be done from here: adds the domain to the
 * email service the first time, reports the DNS records it asks for, and asks it
 * to look for them again while they are missing.
 */
export async function checkEmail(): Promise<EmailStatus> {
  if (!process.env.RESEND_API_KEY) return { status: "not configured" };
  if (cached) {
    const ttl = cached.value.status === "ok" ? OK_TTL_MS : WAITING_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.value;
  }

  let value: EmailStatus;
  try {
    value = await readEmailStatus();
  } catch {
    value = { status: "error: could not reach the email service" };
  }
  cached = { value, at: Date.now() };
  return value;
}

async function readEmailStatus(): Promise<EmailStatus> {
  const name = siteConfig.ordersEmail.split("@")[1];

  const list = await resend<{ data?: Domain[] }>("/domains");
  if (!list.ok) {
    // A key that is only allowed to send can't look at domains.
    return list.data?.name === "restricted_api_key"
      ? { status: "error: the key can only send, so the domain can't be checked or set up from here" }
      : { status: `error: ${list.status}` };
  }

  let domain = list.data?.data?.find((item) => item.name === name);
  if (!domain) {
    const created = await resend<Domain>("/domains", "POST", { name });
    if (!created.ok || !created.data?.id) return { status: `error: could not add ${name} (${created.status})` };
    domain = created.data;
  }
  if (domain.status === "verified") return { status: "ok" };

  // The list leaves the records out, so read the domain itself.
  const detail = await resend<Domain>(`/domains/${domain.id}`);
  if (detail.ok && detail.data?.id) domain = detail.data;
  if (domain.status === "verified") return { status: "ok" };

  // Ask for another look. "pending" means it is already looking.
  if (domain.status !== "pending") await resend(`/domains/${domain.id}/verify`, "POST");

  return {
    status: `waiting for DNS (${domain.status ?? "not started"})`,
    dns: (domain.records ?? []).map((record) => ({
      type: record.type ?? "",
      name: record.name ?? "",
      value: record.value ?? "",
      ...(record.priority === undefined || record.priority === ""
        ? {}
        : { priority: Number(record.priority) }),
      found: record.status === "verified",
    })),
  };
}
