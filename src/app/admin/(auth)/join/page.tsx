import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { JoinForm } from "@/components/admin/auth-forms";
import { readInvite } from "@/lib/admin/invites";
import { MIN_PASSWORD_LENGTH } from "@/lib/admin/passwords";

export const metadata: Metadata = { title: "Join the team" };

export default function JoinPage({ searchParams }: PageProps<"/admin/join">) {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Join the team</h1>
      <Suspense fallback={<p className="text-center text-bone-dim">Checking your invitation…</p>}>
        <Join searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Join({ searchParams }: Pick<PageProps<"/admin/join">, "searchParams">) {
  const { code } = await searchParams;
  await connection();

  const invite = typeof code === "string" ? await readInvite(code) : null;
  if (!invite || typeof code !== "string") {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="text-bone-dim">
          This invitation has already been used or has expired. If you have set your password, sign
          in. Otherwise ask for a new invitation.
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
        Set your name and a password. Next you&apos;ll set up an authenticator app, which takes a
        minute.
      </p>
      <JoinForm code={code} name={invite.name} email={invite.email} minLength={MIN_PASSWORD_LENGTH} />
    </>
  );
}
