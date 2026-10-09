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
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Link href="/" prefetch={false} aria-label="VOIDSZN home" className="self-center">
          <EclipseLogo size={30} />
        </Link>
        {children}
      </div>
    </main>
  );
}
