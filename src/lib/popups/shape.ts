/**
 * Pop-ups on the store: what kinds there are, when they open and what the
 * store needs to know to show one. Safe to import anywhere, including the browser.
 */

export type PopupKind = "EMAIL" | "CODE" | "MESSAGE";
export type PopupTrigger = "DELAY" | "EXIT" | "SCROLL";
export type PopupPages = "ALL" | "HOME" | "PRODUCTS";

export const POPUP_KINDS: Record<PopupKind, { name: string; about: string }> = {
  EMAIL: {
    name: "Email sign-up",
    about: "Asks for an email address and gives a code in return. They join the marketing list.",
  },
  CODE: {
    name: "Code offer",
    about: "Shows a discount code with a button that adds it to their order. Good for a sale.",
  },
  MESSAGE: {
    name: "Announcement",
    about: "A headline, a few words and a button to a page of the store.",
  },
};

export const POPUP_TRIGGERS: Record<PopupTrigger, string> = {
  DELAY: "After a few seconds on the page",
  EXIT: "When they go to leave",
  SCROLL: "After scrolling half way down",
};

export const POPUP_PAGES: Record<PopupPages, string> = {
  ALL: "Every page",
  HOME: "Home page only",
  PRODUCTS: "Product pages only",
};

export const isPopupKind = (value: unknown): value is PopupKind =>
  typeof value === "string" && value in POPUP_KINDS;
export const isPopupTrigger = (value: unknown): value is PopupTrigger =>
  typeof value === "string" && value in POPUP_TRIGGERS;
export const isPopupPages = (value: unknown): value is PopupPages =>
  typeof value === "string" && value in POPUP_PAGES;

export const POPUP_LIMITS = {
  /** How many pop-ups the store keeps. */
  count: 12,
  name: 60,
  eyebrow: 40,
  headline: 60,
  body: 240,
  button: 30,
  url: 200,
  delaySeconds: 120,
  showAgainDays: 365,
};

/** What goes into a pop-up, as the admin form and the database both see it. */
export type PopupContent = {
  /** The owner's own name for it. Never shown to customers. */
  name: string;
  kind: PopupKind;
  isEnabled: boolean;
  /** The small line above the headline, or none. */
  eyebrow: string;
  headline: string;
  body: string;
  buttonLabel: string;
  /** A page of the store, like "/collections/best-sellers". Empty for none. */
  buttonUrl: string;
  discountCodeId: string | null;
  /** Email sign-up only: also send the welcome email with the code. */
  sendsEmail: boolean;
  trigger: PopupTrigger;
  delaySeconds: number;
  pages: PopupPages;
  /** After someone closes it, how many days before it may open for them again. */
  showAgainDays: number;
};

/** A new pop-up of each kind starts from these words. Every one can be changed. */
export const POPUP_STARTERS: Record<PopupKind, PopupContent> = {
  EMAIL: {
    name: "First order sign-up",
    kind: "EMAIL",
    isEnabled: true,
    eyebrow: "First order",
    headline: "Take 10% off",
    body: "Join the list and get a code for your first order. New designs and offers, no spam.",
    buttonLabel: "Get my code",
    buttonUrl: "",
    discountCodeId: null,
    sendsEmail: true,
    trigger: "DELAY",
    delaySeconds: 6,
    pages: "ALL",
    showAgainDays: 7,
  },
  CODE: {
    name: "Sale code",
    kind: "CODE",
    isEnabled: true,
    eyebrow: "This week only",
    headline: "Something off your order",
    body: "Use this code at checkout.",
    buttonLabel: "Use this code",
    buttonUrl: "",
    discountCodeId: null,
    sendsEmail: false,
    trigger: "EXIT",
    delaySeconds: 6,
    pages: "ALL",
    showAgainDays: 3,
  },
  MESSAGE: {
    name: "Announcement",
    kind: "MESSAGE",
    isEnabled: true,
    eyebrow: "Just landed",
    headline: "New designs are in",
    body: "Printed when you order. Take a look before everyone else does.",
    buttonLabel: "See what's new",
    buttonUrl: "/",
    discountCodeId: null,
    sendsEmail: false,
    trigger: "DELAY",
    delaySeconds: 8,
    pages: "HOME",
    showAgainDays: 7,
  },
};

/** One pop-up as the store shows it. Nothing here is private. */
export type LivePopup = {
  id: string;
  kind: PopupKind;
  eyebrow: string | null;
  headline: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string | null;
  trigger: PopupTrigger;
  delaySeconds: number;
  pages: PopupPages;
  showAgainDays: number;
  /**
   * A code offer's code and what it gives. Left out for an email sign-up, where
   * the code is only handed over once they have signed up.
   */
  offer: { code: string; summary: string } | null;
};

/** Cache tag for the store's pop-ups. Saving one in the admin clears this. */
export const POPUPS_TAG = "popups";

/** Pop-ups never open here: places where someone is paying, or isn't a shopper. */
const QUIET_PATHS = ["/admin", "/checkout", "/order", "/cart", "/unsubscribe"];

export const isQuietPath = (pathname: string) =>
  QUIET_PATHS.some((quiet) => pathname === quiet || pathname.startsWith(`${quiet}/`));

export const matchesPages = (pages: PopupPages, pathname: string) =>
  pages === "ALL" || (pages === "HOME" ? pathname === "/" : pathname.startsWith("/products/"));

/** A link to one of the store's own pages: starts with a single slash. */
export const isStorePath = (value: string) => /^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(value);

/** In one line, when and where a pop-up opens. For the list in the admin. */
export function describeTiming(popup: Pick<PopupContent, "trigger" | "delaySeconds" | "pages">): string {
  const when =
    popup.trigger === "DELAY"
      ? `After ${popup.delaySeconds} ${popup.delaySeconds === 1 ? "second" : "seconds"}`
      : popup.trigger === "EXIT"
        ? "When they go to leave"
        : "After scrolling half way";
  const where = popup.pages === "ALL" ? "on every page" : popup.pages === "HOME" ? "on the home page" : "on product pages";
  return `${when}, ${where}`;
}
