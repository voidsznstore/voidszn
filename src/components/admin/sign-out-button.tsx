"use client";

import { useTransition } from "react";
import { endSession, signOut } from "@/app/admin/(auth)/actions";

/**
 * Signs out and then loads the sign-in page from scratch. A plain in-app move
 * would leave the admin pages just visited sitting hidden in the browser's
 * memory, with orders and customer details in them.
 */
export function SignOutButton({ className = "" }: { className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      // Used as is if the page's script hasn't loaded.
      action={signOut}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          await endSession();
          window.location.replace("/admin/login");
        });
      }}
      className={className}
    >
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center text-sm text-smoke link"
      >
        Sign out
      </button>
    </form>
  );
}
