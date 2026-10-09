import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/admin/sign-out-button";
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
      <aside className="p-3 pb-0 md:sticky md:top-0 md:h-dvh md:w-64 md:flex-none md:pb-3 md:pr-0">
        <div className="glass flex h-full flex-col gap-4 rounded-[1.75rem] p-4">
          <div className="flex items-center justify-between gap-4 px-1">
            <Link
              href="/admin"
              aria-label="Admin overview"
              className="inline-flex h-12 items-center px-3"
            >
              <EclipseLogo size={24} />
            </Link>
            <span className="tag tag-mute">Admin</span>
          </div>
          <Suspense fallback={<NavLinks pathname={null} />}>
            <AdminNav />
          </Suspense>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-sm md:mt-auto md:flex-col md:items-start md:border-t md:border-line md:pt-3">
            <Suspense fallback={null}>
              <Identity />
            </Suspense>
            {/* Not prefetched: store pages shouldn't be rebuilt just because the admin is open. */}
            <Link
              href="/"
              prefetch={false}
              className="link inline-flex min-h-11 items-center text-smoke"
            >
              View store
            </Link>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 md:py-9">{children}</main>
    </div>
  );
}

async function Identity() {
  const admin = await getAdmin();
  if (!admin?.twoStep) return null;
  return (
    <>
      <span className="font-semibold text-bone">{admin.name}</span>
      <SignOutButton />
    </>
  );
}
