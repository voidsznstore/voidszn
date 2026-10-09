import type { Metadata } from "next";
import { SignInForm } from "@/components/admin/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <h1 className="display text-center text-4xl text-white">Admin sign in</h1>
      <SignInForm />
    </>
  );
}
