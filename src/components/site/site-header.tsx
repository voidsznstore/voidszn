import Link from "next/link";
import { EclipseLogo } from "@/components/brand/eclipse-logo";

export function SiteHeader() {
  return (
    <>
      <div className="label flex min-h-9 items-center justify-center bg-accent px-4 py-1.5 text-center text-xs text-on-accent">
        Printed to order. No logos on the clothes.
      </div>

      <header className="border-b border-line">
        <div className="mx-auto grid max-w-site grid-cols-3 items-center px-4 py-3 sm:px-10">
          <nav aria-label="Primary" className="flex gap-7 text-sm font-semibold tracking-[0.04em]">
            <Link href="/#shop" className="inline-flex min-h-11 items-center hover:text-white">
              Shop
            </Link>
          </nav>

          <Link
            href="/"
            aria-label="VOIDSZN home"
            className="flex min-h-[3.25rem] items-center justify-center"
          >
            <EclipseLogo size={30} />
          </Link>

          <div className="flex justify-end text-sm font-semibold tracking-[0.04em]">
            {/* Becomes the cart button when the cart is built. */}
            <span className="inline-flex min-h-11 items-center text-smoke">Cart (0)</span>
          </div>
        </div>
      </header>
    </>
  );
}
