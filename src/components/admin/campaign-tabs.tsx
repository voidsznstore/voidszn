import Link from "next/link";

const TABS = [
  { key: "campaigns", label: "Campaigns", href: "/admin/campaigns" },
  { key: "automatic", label: "Automatic emails", href: "/admin/campaigns/automatic" },
] as const;

/** The two halves of email: ones you write and send, and ones the store sends by itself. */
export function CampaignTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Email sections" className="flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === current ? "page" : undefined} className="chip">
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
