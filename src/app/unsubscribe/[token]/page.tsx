import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { UnsubscribeForm } from "@/components/unsubscribe-form";
import { getDb } from "@/db";
import { emailForToken } from "@/db/queries/admin-campaigns";
import { TEST_TOKEN } from "@/lib/email/campaigns";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/unsubscribe/[token]">;

export default function UnsubscribePage({ params }: Props) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center gap-6 px-4 pb-24 pt-16 text-center sm:px-10">
        <h1 className="display text-5xl text-white">Unsubscribe</h1>
        <Suspense fallback={<p className="text-bone-dim">Checking your link…</p>}>
          <Unsubscribe params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

/** Shows part of an address, enough to recognise it without spelling it out. */
function mask(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
}

async function Unsubscribe({ params }: Pick<Props, "params">) {
  const { token } = await params;
  await connection();

  if (token === TEST_TOKEN) {
    return (
      <p className="text-bone-dim">
        This link came from a test email. In the real thing, this page lets the person
        unsubscribe.
      </p>
    );
  }

  const email = await emailForToken(getDb(), token);
  if (!email) {
    return (
      <p className="text-bone-dim">
        This unsubscribe link isn&apos;t valid any more. To stop our emails, write to{" "}
        <a href={`mailto:${siteConfig.supportEmail}`} className="link">
          {siteConfig.supportEmail}
        </a>{" "}
        and we&apos;ll take you off the list.
      </p>
    );
  }
  return <UnsubscribeForm token={token} email={mask(email)} />;
}
