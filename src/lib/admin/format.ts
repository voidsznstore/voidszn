import { siteConfig } from "@/lib/site-config";

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: siteConfig.timeZone,
  dateStyle: "medium",
  timeStyle: "short",
});
const dateOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: siteConfig.timeZone,
  dateStyle: "medium",
});

/** e.g. "Oct 8, 2026, 8:25 PM", in the store's time zone. */
export const formatDateTime = (date: Date) => dateTime.format(date);
/** e.g. "Oct 8, 2026", in the store's time zone. */
export const formatDate = (date: Date) => dateOnly.format(date);

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Not paid",
  PAID: "To fulfil",
  IN_PRODUCTION: "In production",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** What an order's status is called in the admin. */
export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;
