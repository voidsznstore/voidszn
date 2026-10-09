"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/discounts", label: "Discounts" },
  { href: "/admin/sales", label: "Sales" },
  { href: "/admin/accounting", label: "Accounting" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/banner", label: "Banner" },
  { href: "/admin/popups", label: "Pop-ups" },
  { href: "/admin/relay", label: "Relay" },
  { href: "/admin/team", label: "Team" },
  { href: "/admin/security", label: "Security" },
];

/** The nav with the current section marked. Reads the address, so it sits behind a boundary. */
export function AdminNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** The same links with nothing marked, shown for the instant before the address is known. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Admin"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] md:mx-0 md:min-h-0 md:flex-1 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:px-0 md:pb-0 md:[mask-image:none]"
    >
      {links.map((link) => {
        const current =
          pathname !== null &&
          (link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 flex-none items-center rounded-full px-4 text-sm font-semibold transition-colors md:min-h-10 ${
              current
                ? "bg-bone text-void shadow-[0_8px_22px_-12px_rgb(237_234_227/0.6)]"
                : "text-bone-dim hover:bg-white/[0.07] hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
