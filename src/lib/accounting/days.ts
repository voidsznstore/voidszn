import { siteConfig } from "@/lib/site-config";

/**
 * Days on the store's own calendar, written "2026-10-09". The books are kept by
 * day in the store's time zone, so an order paid at 11pm in Orlando belongs to
 * that day, whatever the server's clock says.
 */
export type Day = string;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: siteConfig.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const dayOf = (date: Date): Day => dayFormat.format(date);

export const isDay = (value: unknown): value is Day =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const parts = (day: Day) => day.split("-").map(Number) as [number, number, number];
const pad = (value: number) => String(value).padStart(2, "0");
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The same day of the month, `months` later. The 31st becomes the last day of a shorter month. */
export function addMonths(day: Day, months: number): Day {
  const [year, month, date] = parts(day);
  const index = year * 12 + (month - 1) + months;
  const toYear = Math.floor(index / 12);
  const toMonth = (index % 12) + 1;
  return `${toYear}-${pad(toMonth)}-${pad(Math.min(date, daysIn(toYear, toMonth)))}`;
}

export const monthOf = (day: Day) => day.slice(0, 7);
export const yearOf = (day: Day) => Number(day.slice(0, 4));

const longDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" });
const longMonth = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const shortMonth = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

/** "Oct 9, 2026" */
export const formatDay = (day: Day) => longDay.format(new Date(`${day}T12:00:00Z`));
/** "October 2026", from a day or a "2026-10" month. */
export const formatMonth = (month: string) => longMonth.format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));
/** "Oct 2026" */
export const formatMonthShort = (month: string) =>
  shortMonth.format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));

/** A stretch of days, both ends included. Either end can be left open. */
export type Range = { from?: Day; to?: Day };
export const inRange = (day: Day, range: Range) =>
  (!range.from || day >= range.from) && (!range.to || day <= range.to);
