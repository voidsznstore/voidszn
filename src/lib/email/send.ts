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

let status: { value: string; at: number } | null = null;
const STATUS_TTL_MS = 5 * 60_000;

/** For the health check: whether email can actually go out from the store's domain. */
export async function checkEmail(): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "not configured";
  if (status && Date.now() - status.at < STATUS_TTL_MS) return status.value;

  let value: string;
  try {
    const response = await fetch(`${API()}/domains`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      value = `error: ${response.status}`;
    } else {
      const { data = [] } = (await response.json()) as {
        data?: { name?: string; status?: string }[];
      };
      const domain = siteConfig.ordersEmail.split("@")[1];
      const found = data.find((item) => item.name === domain);
      value = !found
        ? `domain ${domain} not added`
        : found.status === "verified"
          ? "ok"
          : `domain ${found.status ?? "not verified"}`;
    }
  } catch {
    value = "error: could not reach the email service";
  }
  status = { value, at: Date.now() };
  return value;
}
