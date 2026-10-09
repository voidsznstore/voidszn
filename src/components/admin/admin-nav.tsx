"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/sales", label: "Sales" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/security", label: "Security" },
];

/** The nav with the current section marked. Reads the address, so it sits behind a boundary. */
export function AdminNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** The same links with nothing marked, shown for the instant before the address is known. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Admin" className="flex flex-wrap gap-x-1 gap-y-1 md:flex-col">
      {links.map((link) => {
        const current =
          pathname !== null &&
          (link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center px-3 text-sm font-semibold ${
              current ? "bg-ash text-white" : "text-bone-dim hover:bg-ash-soft hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
