import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SetupForm } from "@/components/admin/auth-forms";
import { MIN_PASSWORD_LENGTH } from "@/lib/admin/passwords";
import { isSetupCodeValid } from "@/lib/admin/setup";

export const metadata: Metadata = { title: "Set up your account" };

export default function SetupPage({ searchParams }: PageProps<"/admin/setup">) {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Create your admin account</h1>
      <Suspense fallback={<p className="text-center text-bone-dim">Checking your link…</p>}>
        <Setup searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Setup({ searchParams }: Pick<PageProps<"/admin/setup">, "searchParams">) {
  const { code } = await searchParams;
  await connection();

  if (typeof code !== "string" || !(await isSetupCodeValid(code))) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="text-bone-dim">
          This setup link has already been used or has expired. If you have an account, sign in.
        </p>
        <Link href="/admin/login" className="btn btn-glass">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="text-center text-bone-dim">
        This is the owner account for the store. The link works once.
      </p>
      <SetupForm code={code} minLength={MIN_PASSWORD_LENGTH} />
    </>
  );
}
