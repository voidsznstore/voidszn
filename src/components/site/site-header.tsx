import Link from "next/link";
import { EclipseLogo } from "@/components/brand/eclipse-logo";
import { CartButton } from "@/components/cart/cart-button";
import { getCategories } from "@/lib/catalog";
import { collectionLink, headerLinks, helpLinks } from "@/lib/navigation";
import { SiteMenu } from "./site-menu";

/**
 * A bar of glass that floats at the top and stays there while the page scrolls
 * under it. Three columns: links, logo dead centre, cart.
 */
export async function SiteHeader() {
  const categories = await getCategories();
  const linksFor = (kind: "PRODUCT_TYPE" | "INTEREST") =>
    categories
      .filter((category) => category.kind === kind)
      .map((category) => collectionLink(category.name, category.slug));

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="glass mx-auto grid h-16 max-w-site grid-cols-[1fr_auto_1fr] items-center rounded-full pl-2 pr-2 sm:pl-3 sm:pr-3">
        <div className="flex items-center justify-self-start">
          <SiteMenu
            groups={[
              { title: "Shop", links: headerLinks },
              { title: "Categories", links: linksFor("PRODUCT_TYPE") },
              { title: "Interests", links: linksFor("INTEREST") },
              { title: "Help", links: helpLinks },
            ]}
          />
          <nav aria-label="Primary" className="hidden items-center md:flex">
            {headerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-bone-dim transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <Link
          href="/"
          aria-label="VOIDSZN home"
          className="flex h-12 items-center justify-center rounded-full px-5"
        >
          <EclipseLogo size={26} />
        </Link>

        <div className="justify-self-end">
          <CartButton />
        </div>
      </div>
    </header>
  );
}
