import type { Metadata } from "next";
import Link from "next/link";
import { VerifyForm } from "@/components/admin/two-step-forms";

export const metadata: Metadata = { title: "Enter your code" };

export default function VerifyPage() {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Enter your code</h1>
      <p className="text-center text-bone-dim">
        Open your authenticator app and enter the code it shows for VOIDSZN.
      </p>
      <VerifyForm />
      <Link
        href="/admin/login"
        className="self-center text-sm text-smoke link"
      >
        Start over
      </Link>
    </>
  );
}
