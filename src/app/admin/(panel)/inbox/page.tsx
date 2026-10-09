import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InboxSetup } from "@/components/admin/inbox-setup";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { type Box, MailError, type MailPage, isInboxConfigured, listMessages } from "@/lib/mail/gmail";

export const metadata: Metadata = { title: "Inbox" };

type Props = PageProps<"/admin/inbox">;

export default function InboxPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Inbox"
        action={
          <Link href="/admin/inbox/new" className="btn btn-accent">
            Write an email
          </Link>
        }
      />
      <Suspense fallback={<Loading label="Checking Gmail…" />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const BOXES: Record<Box, string> = { inbox: "Inbox", sent: "Sent" };

async function Inbox({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  if (!isInboxConfigured()) return <InboxSetup />;

  const params = await searchParams;
  const box: Box = one(params.box) === "sent" ? "sent" : "inbox";
  const q = one(params.q)?.slice(0, 200) ?? "";
  const page = Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1);

  let result: MailPage;
  try {
    result = await listMessages(box, { page, q });
  } catch (error) {
    if (!(error instanceof MailError)) throw error;
    return <p className="border border-accent p-5 text-bone-dim">{error.message}</p>;
  }

  const href = (target: { box?: Box; page?: number; q?: string }) => {
    const query = new URLSearchParams();
    const nextBox = target.box ?? box;
    if (nextBox !== "inbox") query.set("box", nextBox);
    const nextQ = target.q ?? q;
    if (nextQ) query.set("q", nextQ);
    if (target.page && target.page > 1) query.set("page", String(target.page));
    const text = query.toString();
    return text ? `/admin/inbox?${text}` : "/admin/inbox";
  };
  const open = (uid: number) => `/admin/inbox/${uid}${box === "sent" ? "?box=sent" : ""}`;

  return (
    <div className="flex flex-col gap-6">
      {one(params.sent) ? (
        <p role="status" className="border border-line bg-ash-soft px-4 py-3 text-bone-dim">
          Sent.
        </p>
      ) : null}

      <nav aria-label="Mailbox" className="flex flex-wrap gap-2">
        {(Object.keys(BOXES) as Box[]).map((key) => (
          <Link
            key={key}
            href={href({ box: key, page: 1 })}
            aria-current={key === box ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border px-4 text-sm font-semibold ${
              key === box ? "border-bone bg-bone text-void" : "border-line-strong hover:border-bone"
            }`}
          >
            {BOXES[key]}
          </Link>
        ))}
      </nav>

      <form key={`${box}|${q}`} className="flex flex-wrap items-end gap-3">
        {box !== "inbox" ? <input type="hidden" name="box" value={box} /> : null}
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="mail-q" className="label text-xs text-smoke">
            Search
          </label>
          <input
            id="mail-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="A name, an email address or a word"
            className="input"
          />
        </div>
        <button type="submit" className="btn btn-outline min-h-[2.875rem] px-5">
          Search
        </button>
        {q ? (
          <Link
            href={box === "inbox" ? "/admin/inbox" : "/admin/inbox?box=sent"}
            className="inline-flex min-h-[2.875rem] items-center text-sm underline underline-offset-4"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {result.messages.length === 0 ? (
        <p className="border border-line bg-ash-soft px-5 py-10 text-center text-bone-dim">
          {q ? "Nothing matches that search." : "Nothing here yet."}
        </p>
      ) : (
        <ul className="flex flex-col border-t border-line">
          {result.messages.map((message) => {
            const who =
              box === "sent"
                ? `To ${message.to.map((person) => person.name || person.address).join(", ") || "nobody"}`
                : message.from.name || message.from.address || "Unknown sender";
            return (
              <li key={message.uid} className="border-b border-line">
                <Link
                  href={open(message.uid)}
                  className="grid min-h-11 gap-x-4 gap-y-0.5 px-2 py-3 hover:bg-ash-soft sm:grid-cols-[14rem_minmax(0,1fr)_auto]"
                >
                  <span className={`truncate ${message.unread ? "font-semibold text-white" : "text-bone-dim"}`}>
                    {message.unread ? <span className="sr-only">Unread: </span> : null}
                    {who}
                  </span>
                  <span className={`truncate ${message.unread ? "font-semibold text-white" : "text-bone-dim"}`}>
                    {message.subject}
                    {message.hasAttachment ? (
                      <>
                        {" "}
                        <span className="label ml-1 text-[0.6875rem] text-smoke">Attachment</span>
                      </>
                    ) : null}
                    {message.answered ? (
                      <>
                        {" "}
                        <span className="label ml-1 text-[0.6875rem] text-smoke">Replied</span>
                      </>
                    ) : null}
                  </span>
                  <span className="text-sm text-smoke">{message.date ? formatDateTime(message.date) : ""}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {result.pages > 1 ? (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-4 text-sm">
          {result.page > 1 ? (
            <Link href={href({ page: result.page - 1 })} className="inline-flex min-h-11 items-center underline underline-offset-4">
              Newer
            </Link>
          ) : null}
          <span className="text-smoke">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link href={href({ page: result.page + 1 })} className="inline-flex min-h-11 items-center underline underline-offset-4">
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
