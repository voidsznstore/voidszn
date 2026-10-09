import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewPasswordForm } from "@/components/admin/auth-forms";
import { isResetTokenValid } from "@/lib/admin/password-reset";
import { MIN_PASSWORD_LENGTH } from "@/lib/admin/passwords";

export const metadata: Metadata = {
  title: "Choose a new password",
  // Keeps the link's code out of the address sent along when leaving this page.
  referrer: "no-referrer",
};

export default function ResetPage({ searchParams }: PageProps<"/admin/reset">) {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Choose a new password</h1>
      <Suspense fallback={<p className="text-center text-bone-dim">Checking your link…</p>}>
        <Reset searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Reset({ searchParams }: Pick<PageProps<"/admin/reset">, "searchParams">) {
  const { token } = await searchParams;
  await connection();

  if (typeof token !== "string" || !(await isResetTokenValid(token))) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="text-bone-dim">
          This reset link has been used or has expired. Ask for a new one.
        </p>
        <Link href="/admin/forgot" className="btn btn-glass">
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="text-center text-bone-dim">
        After this you&apos;ll sign in with the new password and your authenticator app.
      </p>
      <NewPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />
    </>
  );
}
