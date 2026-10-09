import Link from "next/link";
import { getCategories } from "@/lib/catalog";
import { collectionLink, helpLinks, legalLinks, type NavLink } from "@/lib/navigation";
import { siteConfig } from "@/lib/site-config";

function FooterColumn({ title, links }: { title: string; links: NavLink[] }) {
  return (
    <nav aria-label={title} className="flex flex-col">
      <h2 className="label mb-2 text-xs text-smoke">{title}</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-10 items-center text-sm font-semibold uppercase tracking-[0.06em] hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function SiteFooter() {
  const categories = await getCategories();
  const linksFor = (kind: "PRODUCT_TYPE" | "INTEREST") =>
    categories
      .filter((category) => category.kind === kind)
      .map((category) => collectionLink(category.name, category.slug));

  const shopLinks = [
    collectionLink("Best Sellers", "best-sellers"),
    collectionLink("Just In", "just-in"),
    ...linksFor("PRODUCT_TYPE"),
    collectionLink("Shop All", "all"),
  ];
  const interestLinks = linksFor("INTEREST");

  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-site grid-cols-2 gap-x-6 gap-y-10 px-4 py-14 sm:px-10 lg:grid-cols-4">
        <FooterColumn title="Shop" links={shopLinks} />
        {interestLinks.length > 0 ? (
          <FooterColumn title="Shop by interest" links={interestLinks} />
        ) : null}
        <FooterColumn title="Help" links={helpLinks} />
        <FooterColumn title="Legal" links={legalLinks} />
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-site flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-6 sm:px-10">
          <span className="font-display text-2xl leading-none tracking-[0.04em] text-white">
            {siteConfig.name}
          </span>
          <span className="label text-xs text-smoke">
            {siteConfig.legalName}. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
