import Link from "next/link";
import { getCategories } from "@/lib/catalog";
import { collectionLink, helpLinks, legalLinks, type NavLink } from "@/lib/navigation";
import { siteConfig } from "@/lib/site-config";

function FooterColumn({ title, links }: { title: string; links: NavLink[] }) {
  return (
    <nav aria-label={title} className="flex flex-col">
      <h2 className="label mb-2 text-smoke">{title}</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-9 items-center text-[0.9375rem] text-bone-dim transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The foot of every page: a line about the store, the links, and the wordmark
 * very large, cut off along the bottom with the eclipse rising behind it.
 */
export async function SiteFooter() {
  const categories = await getCategories();
  const linksFor = (kind: "PRODUCT_TYPE" | "INTEREST") =>
    categories
      .filter((category) => category.kind === kind)
      .map((category) => collectionLink(category.name, category.slug));

  const shopLinks = [
    collectionLink("Shop All", "all"),
    collectionLink("Best Sellers", "best-sellers"),
    collectionLink("Just In", "just-in"),
    ...linksFor("PRODUCT_TYPE"),
  ];
  const interestLinks = linksFor("INTEREST");
  // Until the legal name is filled in, the store name stands in for it.
  const owner = siteConfig.legalName.startsWith("[") ? siteConfig.name : siteConfig.legalName;

  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto grid max-w-site gap-x-10 gap-y-10 px-4 pb-10 pt-14 sm:px-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <p className="max-w-xs text-xl leading-snug text-bone">
          Nothing is in season.
          <span className="block text-smoke">Graphic tees and more, printed when you order.</span>
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
          <FooterColumn title="Shop" links={shopLinks} />
          {interestLinks.length > 0 ? <FooterColumn title="Interest" links={interestLinks} /> : null}
          <FooterColumn title="Help" links={helpLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
        </div>
      </div>

      <div aria-hidden="true" className="footmark">
        <span className="footmark-ring" />
        <span className="footmark-word">VOIDSZN</span>
      </div>

      <div className="border-t border-line">
        <p className="mx-auto max-w-site px-4 py-4 text-[0.8125rem] text-smoke sm:px-10">
          {owner}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
