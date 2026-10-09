import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SamplePreview } from "@/components/admin/automation-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/session";
import { AUTOMATIC_EMAILS, isAutomaticEmailKey, sampleEmail } from "@/lib/email/samples";
import { isEmailConfigured } from "@/lib/email/send";

export const metadata: Metadata = { title: "Email preview" };

type Props = PageProps<"/admin/campaigns/automatic/[key]">;

export default function AutomaticEmailPage({ params }: Props) {
  return (
    <>
      <Link href="/admin/campaigns/automatic" className="link text-sm text-smoke">
        Automatic emails
      </Link>
      <Suspense fallback={<Loading />}>
        <Preview params={params} />
      </Suspense>
    </>
  );
}

async function Preview({ params }: Pick<Props, "params">) {
  const admin = await requireAdmin();
  const { key } = await params;
  if (!isAutomaticEmailKey(key)) notFound();

  const info = AUTOMATIC_EMAILS.find((email) => email.key === key);
  const email = await sampleEmail(getDb(), key);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={info?.name ?? "Email"} />
      <div className="panel -mt-3 flex flex-col gap-1 p-4">
        <p className="text-sm text-smoke">{info?.when}</p>
        <p>
          <span className="text-smoke">Subject: </span>
          <span className="font-semibold text-white">{email.subject}</span>
        </p>
        <p className="text-[0.8125rem] text-smoke">
          The example uses made-up customer details and your real products.
        </p>
      </div>
      <SamplePreview
        emailKey={key}
        html={email.html}
        title={`Example of the ${info?.name ?? ""} email`}
        testAddress={admin.email}
        canSend={isEmailConfigured()}
      />
    </div>
  );
}
