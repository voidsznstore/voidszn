import { siteConfig } from "@/lib/site-config";

/**
 * Ready-made campaigns to start from. Picking one fills in the editor; every
 * word can then be changed. Safe to import in the browser.
 *
 * They follow what tends to work for a clothing store's email: a subject that
 * says the offer, one idea, a few short lines, and a single button.
 */

export type CampaignPreset = {
  key: string;
  /** What it is called in the picker. */
  name: string;
  /** When to reach for it, in one line. */
  when: string;
  /** Whether it is written around a discount code. The editor then asks for one. */
  wantsDiscount: boolean;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
};

const page = (path: string) => `${siteConfig.url}${path}`;

export const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    key: "new-designs",
    name: "New designs",
    when: "Something new went up in the store.",
    wantsDiscount: false,
    subject: "New designs just landed",
    preheader: "Fresh prints, made when you order.",
    heading: "Just in",
    body: "New designs went up today.\n\nEach one is printed when you order it, so your size is always there.",
    buttonLabel: "See what's new",
    buttonUrl: page("/collections/just-in"),
  },
  {
    key: "sale",
    name: "Sale",
    when: "Money off for a few days. Pick a code with an end date.",
    wantsDiscount: true,
    subject: "The sale is on",
    preheader: "Money off everything, for a few days.",
    heading: "The sale is on",
    body: "For a few days, everything in the store costs less.\n\nTap the button and the code is added for you.",
    buttonLabel: "Shop the sale",
    buttonUrl: page("/collections/all"),
  },
  {
    key: "code",
    name: "A code for the list",
    when: "A thank-you to subscribers, with no occasion needed.",
    wantsDiscount: true,
    subject: "A code, just for the list",
    preheader: "Something off, because you're on the list.",
    heading: "This one's for you",
    body: "Thanks for being on the list. Here's a code for anything in the store.",
    buttonLabel: "Use my code",
    buttonUrl: page("/collections/all"),
  },
  {
    key: "free-shipping",
    name: "Free shipping",
    when: "Pick a free shipping code. Works well over a weekend.",
    wantsDiscount: true,
    subject: "Free shipping, for a few days",
    preheader: "Shipping costs nothing with this code.",
    heading: "Shipping's on us",
    body: "For a few days, shipping costs nothing.\n\nTap the button and the code is added for you.",
    buttonLabel: "Shop with free shipping",
    buttonUrl: page("/collections/all"),
  },
  {
    key: "last-chance",
    name: "Last chance",
    when: "The day a sale or code ends. Send it once.",
    wantsDiscount: true,
    subject: "Last day for your code",
    preheader: "After tonight it stops working.",
    heading: "Ends tonight",
    body: "The code below stops working tonight.\n\nIf something caught your eye, this is the day.",
    buttonLabel: "Use it before it's gone",
    buttonUrl: page("/collections/all"),
  },
  {
    key: "best-sellers",
    name: "Best sellers",
    when: "A quiet week. Shows people what others are buying.",
    wantsDiscount: false,
    subject: "What everyone's wearing",
    preheader: "The designs people keep coming back for.",
    heading: "Best sellers",
    body: "These are the designs people keep coming back for.\n\nEach one is printed when you order it.",
    buttonLabel: "Shop best sellers",
    buttonUrl: page("/collections/best-sellers"),
  },
  {
    key: "welcome",
    name: "Welcome",
    when: "For people who just joined the list. A code helps the first order.",
    wantsDiscount: true,
    subject: `Welcome to ${siteConfig.name}`,
    preheader: "How it works, and something off your first order.",
    heading: "Welcome to the void",
    body: "Thanks for signing up.\n\nHere's how it works: you pick a design, we print it for you, and it ships within a few days. Nothing is in season. Wear what you like.",
    buttonLabel: "Start with the best sellers",
    buttonUrl: page("/collections/best-sellers"),
  },
  {
    key: "come-back",
    name: "Come back",
    when: "For when it has been a while. A code gives a reason to look again.",
    wantsDiscount: true,
    subject: "It's been a while",
    preheader: "New designs since your last visit, and something off.",
    heading: "Still here",
    body: "A lot of new designs have landed since you last looked.\n\nCome and see, with something off.",
    buttonLabel: "See what's new",
    buttonUrl: page("/collections/just-in"),
  },
  {
    key: "occasion",
    name: "Holiday or occasion",
    when: "Halloween, the holidays, a big release. Fill in the parts in [brackets].",
    wantsDiscount: false,
    subject: "The [OCCASION] designs are here",
    preheader: "Order by [DATE] to have it in time.",
    heading: "[OCCASION] is coming",
    body: `The [OCCASION] designs are up.\n\nEverything is printed to order, which takes ${siteConfig.shipping.productionDays} business days, plus ${siteConfig.shipping.transitDays} to ship. Order by [DATE] to have yours in time.`,
    buttonLabel: "Shop the collection",
    buttonUrl: page("/collections/all"),
  },
];

/** True when text still has a [PLACEHOLDER] in it that the owner was meant to replace. */
export const hasPlaceholder = (text: string) => /\[[A-Z][A-Z ]{1,30}\]/.test(text);
