import type { Metadata } from "next";
import Link from "next/link";
import { EclipseLogo } from "@/components/brand/eclipse-logo";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | VOIDSZN Admin" },
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: LayoutProps<"/admin">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-md flex-col gap-7">
        <Link
          href="/"
          prefetch={false}
          aria-label="VOIDSZN home"
          className="inline-flex h-14 items-center self-center px-4"
        >
          <EclipseLogo size={30} />
        </Link>
        <div className="glass flex flex-col gap-7 rounded-[1.75rem] px-6 py-8 sm:px-8">{children}</div>
      </div>
    </main>
  );
}
