import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InboxSetup } from "@/components/admin/inbox-setup";
import { ComposeForm } from "@/components/admin/mail-forms";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/admin/session";
import { inboxAddress, isInboxConfigured } from "@/lib/mail/gmail";

export const metadata: Metadata = { title: "Write an email" };

type Props = PageProps<"/admin/inbox/new">;

export default function NewMailPage({ searchParams }: Props) {
  return (
    <>
      <Link href="/admin/inbox" className="text-sm text-smoke link">
        Inbox
      </Link>
      <PageHeader title="Write an email" />
      <Suspense fallback={<Loading />}>
        <NewMail searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function NewMail({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  if (!isInboxConfigured()) return <InboxSetup />;
  const params = await searchParams;
  return (
    <ComposeForm
      to={one(params.to)?.slice(0, 254) ?? ""}
      subject={one(params.subject)?.slice(0, 250) ?? ""}
      from={inboxAddress()}
    />
  );
}
