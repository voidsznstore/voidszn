import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/admin/(auth)/actions";
import { AdminNav, NavLinks } from "@/components/admin/admin-nav";
import { EclipseLogo } from "@/components/brand/eclipse-logo";
import { getAdmin } from "@/lib/admin/session";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | VOIDSZN Admin" },
  robots: { index: false, follow: false },
};

/**
 * Frame around every admin screen. It shows nothing private by itself: each page
 * checks the sign-in before it loads any data.
 */
export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b border-line px-4 py-4 md:w-56 md:flex-none md:border-b-0 md:border-r md:py-6">
        <div className="flex items-center justify-between gap-4 md:flex-col md:items-start">
          <Link href="/admin" aria-label="Admin overview" className="inline-flex min-h-11 items-center">
            <EclipseLogo size={24} />
          </Link>
          <span className="label text-xs text-smoke">Admin</span>
        </div>
        <Suspense fallback={<NavLinks pathname={null} />}>
          <AdminNav />
        </Suspense>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm md:mt-auto md:flex-col md:items-start">
          <Suspense fallback={null}>
            <Identity />
          </Suspense>
          <Link href="/" className="inline-flex min-h-11 items-center text-smoke underline underline-offset-4 hover:text-bone">
            View store
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}

async function Identity() {
  const admin = await getAdmin();
  if (!admin) return null;
  return (
    <>
      <span className="text-bone-dim">{admin.name}</span>
      <form action={signOut}>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center text-smoke underline underline-offset-4 hover:text-bone"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
