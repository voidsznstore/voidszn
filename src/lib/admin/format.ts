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

/* ------------------------------------------------------------------ */
/* Dates typed into forms, in the store's time zone                    */
/* ------------------------------------------------------------------ */

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: siteConfig.timeZone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The clock on the store's wall at this moment, as numbers. */
function wallClock(date: Date) {
  const parts = Object.fromEntries(
    zoneParts.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A moment as a date-and-time field's value ("2026-10-31T23:59"), in the store's time zone. */
export function toLocalInput(date: Date | null): string {
  if (!date) return "";
  const wall = wallClock(date);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Reads a date-and-time field's value as a time in the store's time zone. Null if it isn't one. */
export function fromLocalInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);

  // Start by pretending the wall time is UTC, see what the wall says then, and
  // correct by the difference. Twice, so the hours around a clock change come out right.
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const wall = wallClock(new Date(guess));
    const shown = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    guess += wanted - shown;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** What the store's time zone is called, e.g. "Eastern Time". */
export function timeZoneName(): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: siteConfig.timeZone, timeZoneName: "longGeneric" })
    .formatToParts(new Date())
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? siteConfig.timeZone;
}
