import Link from "next/link";
import { EclipseLogo } from "@/components/brand/eclipse-logo";
import { headerLinks } from "@/lib/navigation";

export function SiteHeader() {
  return (
    <>
      <div className="label flex min-h-9 items-center justify-center bg-accent px-4 py-1.5 text-center text-xs text-on-accent">
        Printed to order
      </div>

      <header className="border-b border-line">
        <div className="mx-auto grid max-w-site grid-cols-[1fr_auto_1fr] items-center gap-x-4 px-4 py-3 sm:px-10">
          <nav
            aria-label="Primary"
            className="flex flex-wrap gap-x-6 text-sm font-semibold tracking-[0.04em]"
          >
            {headerLinks.map((link, index) => (
              <Link
                key={link.href}
                href={link.href}
                // On phones only the first link fits beside the logo. The rest are in the footer.
                className={`min-h-11 items-center hover:text-white ${
                  index === 0 ? "inline-flex" : "hidden md:inline-flex"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/"
            aria-label="VOIDSZN home"
            className="flex min-h-[3.25rem] items-center justify-center px-3"
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
