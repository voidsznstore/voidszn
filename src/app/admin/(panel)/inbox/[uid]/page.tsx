import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MarkUnreadForm, ReplyForm } from "@/components/admin/mail-forms";
import { Loading } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { type Box, MailError, type MailMessage, type Person, getMessage, inboxAddress, isInboxConfigured } from "@/lib/mail/gmail";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Message" };

type Props = PageProps<"/admin/inbox/[uid]">;

export default function MessagePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Loading label="Opening the message…" />}>
      <Message params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const panel = "flex flex-col gap-4 panel p-5";
const small = "text-[0.8125rem] text-smoke";
const show = (person: Person) => (person.name ? `${person.name} <${person.address}>` : person.address);

/**
 * The email's own HTML, wrapped so it can do nothing but be looked at. The frame
 * it goes in runs no scripts and submits no forms; this adds a rule that blocks
 * every outside request, so opening an email tells the sender nothing. Pictures
 * load only when asked for.
 */
function frameDocument(source: string, pictures: boolean): string {
  const images = pictures ? "img-src data: https: http:" : "img-src data:";
  // Not for safety (the frame and the rule above do that): these tags can make a
  // browser look up or connect to the sender's servers before any rule applies.
  const html = pictures ? source : source.replace(/<(link|meta)\b[^>]*>/gi, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${images}"><base target="_blank"><style>html{background:#ffffff}body{margin:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111111;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function Message({ params, searchParams }: Props) {
  await requireAdmin();
  if (!isInboxConfigured()) notFound();
  const [{ uid: rawUid }, query] = await Promise.all([params, searchParams]);
  const uid = /^\d{1,10}$/.test(rawUid) ? Number(rawUid) : 0;
  const box: Box = query.box === "sent" ? "sent" : "inbox";
  const pictures = query.pictures === "1";
  const back = box === "sent" ? "/admin/inbox?box=sent" : "/admin/inbox";

  let message: MailMessage | null;
  try {
    message = uid > 0 ? await getMessage(box, uid) : null;
  } catch (error) {
    if (!(error instanceof MailError)) throw error;
    return (
      <div className="flex flex-col gap-4">
        <Link href={back} className="text-sm text-smoke link">
          Back
        </Link>
        <p className="notice p-5 text-bone-dim">{error.message}</p>
      </div>
    );
  }
  if (!message) notFound();

  // If the other person is a customer, link to them.
  const other = box === "sent" ? message.to[0] : message.from;
  const [customer] = other?.address
    ? await getDb().select({ id: customers.id }).from(customers).where(eq(customers.email, other.address)).limit(1)
    : [];
  const self = `/admin/inbox/${uid}${box === "sent" ? "?box=sent&" : "?"}`;
  const replySubject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={back} className="text-sm text-smoke link">
          {box === "sent" ? "Sent" : "Inbox"}
        </Link>
        <h1 className="text-2xl font-semibold text-white">{message.subject}</h1>
        <dl className="flex flex-col gap-0.5 text-sm text-bone-dim">
          <div className="flex gap-2">
            <dt className="text-smoke">From</dt>
            <dd className="min-w-0 break-words">{show(message.from)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-smoke">To</dt>
            <dd className="min-w-0 break-words">{message.to.map(show).join(", ") || "Nobody listed"}</dd>
          </div>
          {message.cc.length > 0 ? (
            <div className="flex gap-2">
              <dt className="text-smoke">Cc</dt>
              <dd className="min-w-0 break-words">{message.cc.map(show).join(", ")}</dd>
            </div>
          ) : null}
          {message.date ? (
            <div className="flex gap-2">
              <dt className="text-smoke">Sent</dt>
              <dd>{formatDateTime(message.date)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="flex flex-wrap items-center gap-x-6">
          {customer ? (
            <Link href={`/admin/customers/${customer.id}`} className="inline-flex min-h-11 items-center text-sm link">
              This is a customer: see their orders
            </Link>
          ) : null}
          {box === "inbox" ? <MarkUnreadForm box={box} uid={uid} /> : null}
        </div>
      </header>

      <section className={panel}>
        {message.html ? (
          <>
            <iframe
              title="The message"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              srcDoc={frameDocument(message.html, pictures)}
              className="h-[36rem] w-full border border-line bg-white"
            />
            <p className={small}>
              {pictures ? (
                "Pictures are showing. The sender can tell they were loaded."
              ) : (
                <>
                  Pictures from the internet are blocked, which is how senders usually see that
                  an email was opened.{" "}
                  <Link href={`${self}pictures=1`} className="link">
                    Show pictures
                  </Link>
                </>
              )}
            </p>
          </>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-bone">{message.text || "(This message is empty.)"}</pre>
        )}

        {message.attachments.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="text-sm font-semibold">Attachments</h2>
            <ul className="flex flex-col">
              {message.attachments.map((file) => (
                <li key={file.index}>
                  <a
                    href={`/api/admin/inbox/attachment?box=${box}&uid=${uid}&index=${file.index}`}
                    download={file.name}
                    className="inline-flex min-h-11 items-center gap-2 link"
                  >
                    {file.name}
                    <span className="text-sm text-smoke no-underline">{size(file.size)}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className={small}>Attachments download to your computer. Only open ones you expect.</p>
          </div>
        ) : null}
      </section>

      <section className={panel}>
        <h2 className="text-lg font-semibold text-white">{box === "sent" ? "Write again" : "Reply"}</h2>
        <ReplyForm
          key={uid}
          box={box}
          uid={uid}
          to={box === "sent" ? message.to.map((person) => person.address).join(", ") : message.replyTo.address}
          subject={replySubject}
          from={inboxAddress()}
        />
      </section>
    </div>
  );
}
