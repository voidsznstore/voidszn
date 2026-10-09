import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signOut } from "@/app/admin/(auth)/actions";
import { EnrolForm } from "@/components/admin/two-step-forms";
import { requireSignedIn } from "@/lib/admin/session";
import { beginEnrolment } from "@/lib/admin/two-step";

export const metadata: Metadata = { title: "Set up your authenticator app" };

export default function AuthenticatorPage() {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Set up two-step sign-in</h1>
      <Suspense fallback={<p className="text-center text-bone-dim">Loading…</p>}>
        <Enrol />
      </Suspense>
    </>
  );
}

async function Enrol() {
  const admin = await requireSignedIn();
  if (admin.twoStep) redirect("/admin");
  const { secret, qrCode } = await beginEnrolment(admin);

  return (
    <>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-bone-dim">
        <li>
          Install <strong className="text-bone">Google Authenticator</strong> on your phone (any
          authenticator app works).
        </li>
        <li>In the app, tap the plus button, choose to scan a QR code, and scan this one.</li>
        <li>Enter the six-digit code the app shows.</li>
      </ol>

      <Image
        src={qrCode}
        alt="QR code to scan with your authenticator app"
        width={264}
        height={264}
        unoptimized
        className="self-center"
      />

      <details className="text-sm text-bone-dim">
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
          Can&apos;t scan it? Enter the key by hand
        </summary>
        <p className="pt-1">
          In the app choose to enter a setup key. Account: <strong className="text-bone">VOIDSZN</strong>.
          Key:
        </p>
        <p className="break-all pt-2 font-mono text-base text-white" data-testid="setup-key">
          {secret.match(/.{1,4}/g)?.join(" ")}
        </p>
      </details>

      <EnrolForm />

      <form action={signOut} className="self-center">
        <button type="submit" className="inline-flex min-h-11 items-center text-sm text-smoke underline underline-offset-4 hover:text-bone">
          Sign out
        </button>
      </form>
    </>
  );
}
