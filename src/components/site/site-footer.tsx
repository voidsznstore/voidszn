import Link from "next/link";
import { EclipseLogo } from "@/components/brand/eclipse-logo";
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
              className="inline-flex min-h-10 items-center text-[0.9375rem] text-bone-dim transition-colors hover:text-white"
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
  // Until the legal name is filled in, the store name stands in for it.
  const owner = siteConfig.legalName.startsWith("[") ? siteConfig.name : siteConfig.legalName;

  return (
    <footer className="mt-auto px-3 pb-3 sm:px-6 sm:pb-6">
      <div className="panel mx-auto max-w-site overflow-hidden">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 px-6 py-12 sm:px-10 lg:grid-cols-4">
          <FooterColumn title="Shop" links={shopLinks} />
          {interestLinks.length > 0 ? (
            <FooterColumn title="Interests" links={interestLinks} />
          ) : null}
          <FooterColumn title="Help" links={helpLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
        </div>

        <div className="flex flex-col items-center gap-5 border-t border-line px-6 py-8 text-center sm:px-10">
          <Link href="/" aria-label="VOIDSZN home" className="inline-flex h-12 items-center px-4">
            <EclipseLogo size={26} />
          </Link>
          <p className="text-sm text-smoke">{owner}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
