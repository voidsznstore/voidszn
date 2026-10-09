import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-site flex-1 flex-col items-center px-4 pb-24 pt-8 text-center sm:px-10">
        <div
          className="relative flex w-full items-center justify-center"
          style={{ height: "var(--disc)", ["--disc" as string]: "clamp(13rem, 30vw, 20rem)" }}
        >
          <span
            aria-hidden="true"
            className="eclipse left-1/2 top-0 -translate-x-1/2"
            style={{ fontSize: "var(--disc)" }}
          />
          <h1 className="display relative text-[clamp(3rem,10vw,6.5rem)] text-white">
            Nothing here
          </h1>
        </div>
        <p className="mt-7 max-w-md text-balance text-lg text-bone-dim">
          That page doesn&apos;t exist, or the design has been retired.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/collections/all" className="btn btn-accent min-w-40">
            Shop all
          </Link>
          <Link href="/" className="btn btn-glass min-w-40">
            Back to the store
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
