import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/admin/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Admin sign in</h1>
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <SignInForm />
    </>
  );
}

/** Explains why someone has landed here: after a password reset, or sent back from the code step. */
async function Notice({ searchParams }: Pick<PageProps<"/admin/login">, "searchParams">) {
  const { expired, reset } = await searchParams;
  const message = reset
    ? "Password changed. Sign in with the new one."
    : expired
      ? "That took too long, or the code was wrong too many times. Sign in again."
      : null;
  if (!message) return null;
  return (
    <p className="border border-line bg-ash-soft px-4 py-3 text-center text-sm text-bone-dim">
      {message}
    </p>
  );
}
