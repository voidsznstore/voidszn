import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "@/components/admin/auth-forms";

export const metadata: Metadata = { title: "Forgot your password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Forgot your password</h1>
      <p className="text-center text-bone-dim">
        Enter your admin email and we&apos;ll send a link to choose a new one.
      </p>
      <ForgotForm />
      <Link
        href="/admin/login"
        className="self-center text-sm text-smoke link"
      >
        Back to sign in
      </Link>
    </>
  );
}
