import "server-only";
import { ImapFlow } from "imapflow";
import { type ParsedMail, simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { siteConfig } from "@/lib/site-config";

/**
 * The store's Gmail inbox, read and written the way a mail app does it: IMAP to
 * read, SMTP to send. Needs GMAIL_APP_PASSWORD, an "app password" made in the
 * Google account for `siteConfig.inboxEmail`. Nothing is copied into the store's
 * database: every page reads straight from Gmail.
 */

type Config = {
  user: string;
  pass: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
};

/** "host:port", with "plain:" in front for a test server that doesn't use TLS. */
function endpoint(value: string | undefined, fallback: { host: string; port: number }) {
  if (!value) return { ...fallback, secure: true };
  const plain = value.startsWith("plain:");
  const [host, port] = value.replace(/^plain:/, "").split(":");
  return { host, port: Number(port) || fallback.port, secure: !plain };
}

function readConfig(): Config | null {
  // Google shows app passwords in groups of four with spaces between. They work either way.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!pass) return null;
  return {
    user: process.env.GMAIL_ADDRESS ?? siteConfig.inboxEmail,
    pass,
    imap: endpoint(process.env.GMAIL_IMAP, { host: "imap.gmail.com", port: 993 }),
    smtp: endpoint(process.env.GMAIL_SMTP, { host: "smtp.gmail.com", port: 465 }),
  };
}

export function isInboxConfigured(): boolean {
  return readConfig() !== null;
}

/** The address the inbox reads and sends as. */
export function inboxAddress(): string {
  return process.env.GMAIL_ADDRESS ?? siteConfig.inboxEmail;
}

/** A problem worth showing to the owner as written. */
export class MailError extends Error {}

export type Box = "inbox" | "sent";
export const PAGE_SIZE = 25;
/** Bigger messages are not opened here. Gmail itself allows 25 MB. */
const MAX_OPEN_BYTES = 20 * 1024 * 1024;

function explain(error: unknown): MailError {
  if (error instanceof MailError) return error;
  const failed = typeof error === "object" && error !== null ? (error as { authenticationFailed?: boolean; code?: string }) : {};
  if (failed.authenticationFailed) {
    return new MailError(
      "Gmail refused the sign-in. The app password may have been removed or typed wrong. Make a new one and replace GMAIL_APP_PASSWORD.",
    );
  }
  console.error("[inbox] Gmail request failed", error);
  return new MailError("Gmail could not be reached just now. Try again in a moment.");
}

/** Opens a connection, runs the work in one mailbox, and always closes the connection. */
async function withMailbox<T>(box: Box, work: (client: ImapFlow, path: string) => Promise<T>): Promise<T> {
  const config = readConfig();
  if (!config) throw new MailError("The inbox isn't connected yet.");

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    // A page should fail quickly rather than hang if Gmail doesn't answer.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableAutoIdle: true,
  });
  // Without a listener a dropped connection would crash the whole server process.
  client.on("error", () => {});

  try {
    await client.connect();
    const path = box === "inbox" ? "INBOX" : await sentPath(client);
    const lock = await client.getMailboxLock(path);
    try {
      return await work(client, path);
    } finally {
      lock.release();
    }
  } catch (error) {
    throw explain(error);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Gmail's Sent folder has a different name in every language, so find it by what it is. */
async function sentPath(client: ImapFlow): Promise<string> {
  const boxes = await client.list();
  const sent = boxes.find((item) => item.specialUse === "\\Sent");
  if (!sent) throw new MailError("Gmail's Sent folder could not be found.");
  return sent.path;
}

export type Person = { name: string; address: string };

export type MailSummary = {
  uid: number;
  from: Person;
  to: Person[];
  subject: string;
  date: Date | null;
  unread: boolean;
  answered: boolean;
  hasAttachment: boolean;
};

type Address = { name?: string; address?: string };
const person = (value: Address | undefined): Person => ({
  name: value?.name?.trim() ?? "",
  address: value?.address?.trim().toLowerCase() ?? "",
});

type Structure = { disposition?: string; childNodes?: Structure[] };
const hasAttachment = (node: Structure | undefined): boolean =>
  Boolean(node) &&
  (node?.disposition?.toLowerCase() === "attachment" || (node?.childNodes ?? []).some(hasAttachment));

export type MailPage = {
  messages: MailSummary[];
  /** How many messages there are in all, or how many matched the search. */
  total: number;
  page: number;
  pages: number;
};

/**
 * One page of a mailbox, newest first. `q` searches it the way Gmail's own
 * search box does (words, `from:`, `to:`, `subject:` and so on).
 */
export async function listMessages(
  box: Box,
  options: { page?: number; q?: string } = {},
): Promise<MailPage> {
  const q = options.q?.trim();
  return withMailbox(box, async (client) => {
    const fields = { uid: true, envelope: true, flags: true, bodyStructure: true } as const;
    let range: string;
    let total: number;
    let byUid = false;

    if (q) {
      const found = await client.search(
        client.capabilities.has("X-GM-EXT-1")
          ? { gmraw: q }
          : { or: [{ from: q }, { to: q }, { subject: q }, { body: q }] },
        { uid: true },
      );
      const uids = (found || []).sort((a, b) => a - b);
      total = uids.length;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(Math.max(1, options.page ?? 1), pages);
      const end = total - (page - 1) * PAGE_SIZE;
      const slice = uids.slice(Math.max(0, end - PAGE_SIZE), end);
      if (slice.length === 0) return { messages: [], total, page, pages };
      range = slice.join(",");
      byUid = true;
      const rows = await client.fetchAll(range, fields, { uid: byUid });
      return { messages: rows.map(summary).sort(newestFirst), total, page, pages };
    }

    total = client.mailbox ? client.mailbox.exists : 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, options.page ?? 1), pages);
    if (total === 0) return { messages: [], total, page, pages };
    // Messages are numbered oldest to newest, so the newest page is the highest numbers.
    const end = total - (page - 1) * PAGE_SIZE;
    range = `${Math.max(1, end - PAGE_SIZE + 1)}:${end}`;
    const rows = await client.fetchAll(range, fields);
    return { messages: rows.map(summary).sort(newestFirst), total, page, pages };
  });
}

function toDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const newestFirst = (a: MailSummary, b: MailSummary) => b.uid - a.uid;

function summary(row: {
  uid: number;
  envelope?: { from?: Address[]; to?: Address[]; subject?: string; date?: Date | string };
  flags?: Set<string>;
  bodyStructure?: Structure;
}): MailSummary {
  return {
    uid: row.uid,
    from: person(row.envelope?.from?.[0]),
    to: (row.envelope?.to ?? []).map(person),
    subject: row.envelope?.subject?.trim() || "(no subject)",
    date: toDate(row.envelope?.date),
    unread: !row.flags?.has("\\Seen"),
    answered: Boolean(row.flags?.has("\\Answered")),
    hasAttachment: hasAttachment(row.bodyStructure),
  };
}

export type MailMessage = MailSummary & {
  cc: Person[];
  /** Where a reply should go: the Reply-To address if the sender set one. */
  replyTo: Person;
  messageId: string | null;
  references: string[];
  text: string;
  /** The HTML version as sent. Only ever shown inside a locked-down frame. */
  html: string | null;
  attachments: { index: number; name: string; type: string; size: number }[];
};

const people = (value: ParsedMail["to"]): Person[] =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) => group.value.map(person));

async function fetchParsed(client: ImapFlow, uid: number) {
  const row = await client.fetchOne(String(uid), { uid: true, flags: true, size: true }, { uid: true });
  if (!row) return null;
  if ((row.size ?? 0) > MAX_OPEN_BYTES) {
    throw new MailError("This message is too large to open here. Open it in Gmail instead.");
  }
  const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!full || !full.source) return null;
  return { flags: row.flags ?? new Set<string>(), parsed: await simpleParser(full.source) };
}

/** Files sent along with a message. Pictures placed inside the message itself are left out. */
const filesOf = (parsed: ParsedMail) =>
  parsed.attachments.filter((file) => file.contentDisposition === "attachment" || !file.related);

/** One message in full. Opening it marks it as read, the way a mail app does. */
export async function getMessage(box: Box, uid: number): Promise<MailMessage | null> {
  return withMailbox(box, async (client) => {
    const found = await fetchParsed(client, uid);
    if (!found) return null;
    const { parsed, flags } = found;
    if (!flags.has("\\Seen")) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });

    const from = person(parsed.from?.value[0]);
    const references = [parsed.references ?? []].flat();
    return {
      uid,
      from,
      to: people(parsed.to),
      cc: people(parsed.cc),
      replyTo: parsed.replyTo?.value[0]?.address ? person(parsed.replyTo.value[0]) : from,
      subject: parsed.subject?.trim() || "(no subject)",
      date: parsed.date ?? null,
      unread: false,
      answered: flags.has("\\Answered"),
      hasAttachment: filesOf(parsed).length > 0,
      messageId: parsed.messageId ?? null,
      references,
      text: parsed.text ?? "",
      html: parsed.html || null,
      attachments: filesOf(parsed).map((file, index) => ({
        index,
        name: file.filename || `attachment-${index + 1}`,
        type: file.contentType,
        size: file.size,
      })),
    };
  });
}

/** The contents of one file attached to a message. */
export async function getAttachment(
  box: Box,
  uid: number,
  index: number,
): Promise<{ name: string; content: Buffer } | null> {
  return withMailbox(box, async (client) => {
    const found = await fetchParsed(client, uid);
    const file = found ? filesOf(found.parsed)[index] : undefined;
    if (!file) return null;
    return { name: file.filename || `attachment-${index + 1}`, content: file.content };
  });
}

export async function markUnread(box: Box, uid: number): Promise<void> {
  await withMailbox(box, async (client) => {
    await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
  });
}

export type Outgoing = {
  to: string;
  subject: string;
  text: string;
  /** Set on a reply so mail apps show it in the same conversation. */
  inReplyTo?: { box: Box; uid: number; messageId: string | null; references: string[] };
};

/** Sends an email as the store's Gmail address. Gmail keeps its own copy in Sent. */
export async function sendMail(mail: Outgoing): Promise<void> {
  const config = readConfig();
  if (!config) throw new MailError("The inbox isn't connected yet.");

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const original = mail.inReplyTo;
  try {
    await transport.sendMail({
      from: { name: siteConfig.name, address: config.user },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(original?.messageId
        ? { inReplyTo: original.messageId, references: [...original.references, original.messageId] }
        : {}),
    });
  } catch (error) {
    const failed = error as { code?: string; responseCode?: number };
    if (failed.code === "EAUTH") throw explain({ authenticationFailed: true });
    if (failed.code === "EENVELOPE" || failed.responseCode === 553 || failed.responseCode === 550) {
      throw new MailError("Gmail wouldn't send to that address. Check it for typos.");
    }
    console.error("[inbox] Sending failed", error);
    throw new MailError("Gmail could not send it just now. Nothing was sent. Try again in a moment.");
  } finally {
    transport.close();
  }

  // Shows the original as answered. Not worth failing the send over.
  if (original) {
    await withMailbox(original.box, async (client) => {
      await client.messageFlagsAdd(String(original.uid), ["\\Answered"], { uid: true });
    }).catch(() => {});
  }
}

let checked: { value: string; at: number; settings: string } | null = null;
const CHECK_TTL_MS = 5 * 60_000;

/**
 * For the health check: whether the inbox can sign in to Gmail. The answer is
 * kept for a few minutes, so the public health page can't be used to hammer Gmail.
 */
export async function checkInbox(): Promise<string> {
  const config = readConfig();
  if (!config) return "not configured";
  // A changed password or server is checked afresh.
  const settings = `${config.user}|${config.pass}|${config.imap.host}:${config.imap.port}`;
  if (checked && checked.settings === settings && Date.now() - checked.at < CHECK_TTL_MS) {
    return checked.value;
  }

  let value: string;
  try {
    await withMailbox("inbox", async () => {});
    value = "ok";
  } catch (error) {
    value =
      error instanceof MailError && error.message.startsWith("Gmail refused")
        ? "error: Gmail refused the sign-in"
        : "error: could not reach Gmail";
  }
  checked = { value, at: Date.now(), settings };
  return value;
}
