export type NavLink = { label: string; href: string };

export const collectionLink = (label: string, slug: string): NavLink => ({
  label,
  href: `/collections/${slug}`,
});

export const headerLinks: NavLink[] = [
  collectionLink("Shop All", "all"),
  collectionLink("Best Sellers", "best-sellers"),
  collectionLink("Just In", "just-in"),
];

export const helpLinks: NavLink[] = [
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
  { label: "Size Guide", href: "/size-guide" },
  { label: "Shipping", href: "/shipping" },
  { label: "Returns", href: "/returns" },
];

export const legalLinks: NavLink[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "IP and Publicity Rights", href: "/ip-policy" },
  { label: "Accessibility", href: "/accessibility" },
];
