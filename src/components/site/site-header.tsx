import Link from "next/link";
import { EclipseLogo } from "@/components/brand/eclipse-logo";
import { CartButton } from "@/components/cart/cart-button";
import { getBanner } from "@/lib/banner";
import { getCategories } from "@/lib/catalog";
import { collectionLink, headerLinks, helpLinks } from "@/lib/navigation";
import { BannerStrip } from "./banner";
import { NavMenu } from "./nav-menu";
import { SiteMenu } from "./site-menu";

const navLink =
  "inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-bone-dim transition-colors hover:bg-white/[0.07] hover:text-white";

/**
 * The bar across the top: logo on the left, the ways into the store in the
 * middle, the cart on the right. It stays put while the page scrolls under it.
 * The moving banner sits just below and scrolls away with the page.
 */
export async function SiteHeader() {
  const [categories, banner] = await Promise.all([getCategories(), getBanner()]);
  const linksFor = (kind: "PRODUCT_TYPE" | "INTEREST") =>
    categories
      .filter((category) => category.kind === kind)
      .map((category) => collectionLink(category.name, category.slug));
  const types = linksFor("PRODUCT_TYPE");
  const interests = linksFor("INTEREST");
  const [shopAll, ...otherLinks] = headerLinks;

  return (
    <>
      <header className="glass sticky top-0 z-40 border-x-0 border-t-0">
        <div className="mx-auto grid h-[4.25rem] max-w-site grid-cols-[1fr_auto_1fr] items-center gap-x-4 px-4 sm:px-10">
          <Link
            href="/"
            aria-label="VOIDSZN home"
            className="flex h-12 items-center justify-self-start rounded-full pl-2 pr-4"
          >
            <EclipseLogo size={26} />
          </Link>

          <nav aria-label="Primary" className="hidden items-center md:flex">
            <Link href={shopAll.href} className={navLink}>
              {shopAll.label}
            </Link>
            <NavMenu label="Category" links={types} allHref={shopAll.href} />
            <NavMenu label="Interest" links={interests} allHref={shopAll.href} />
            {otherLinks.map((link) => (
              <Link key={link.href} href={link.href} className={navLink}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="col-start-3 flex items-center justify-self-end">
            <SiteMenu
              groups={[
                { title: "Shop", links: headerLinks },
                { title: "Category", links: types },
                { title: "Interest", links: interests },
                { title: "Help", links: helpLinks },
              ]}
            />
            <CartButton />
          </div>
        </div>
      </header>
      <BannerStrip banner={banner} />
    </>
  );
}
