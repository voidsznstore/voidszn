import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-site flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-10 sm:px-10">
        <div className="flex flex-col gap-1">
          <span className="font-display text-[1.75rem] leading-none tracking-[0.04em] text-white">
            VOIDSZN
          </span>
          <span className="text-sm text-smoke">Nothing is in season.</span>
        </div>
        <Link href="/#shop" className="inline-flex min-h-11 items-center text-sm hover:text-white">
          Shop
        </Link>
        <span className="label text-xs text-smoke">VOIDSZN. All rights reserved.</span>
      </div>
    </footer>
  );
}
