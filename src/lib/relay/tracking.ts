/**
 * Finds the tracking details on an order in the relay store. There is no one
 * place WooCommerce keeps them: each shipping or printing plugin writes its own
 * fields, and some only leave a note on the order. This reads the common ones.
 *
 * Nothing here talks to anything; it only reads what it is given.
 */

export type Tracking = { carrier: string; number: string; url: string };

type Meta = { key: string; value: unknown };

const text = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

/** A tracking link is only ever kept if it is a plain https address. */
function safeUrl(value: unknown): string {
  const raw = text(value);
  if (!raw || raw.length > 500) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * A tracking number as carriers hand them out: letters, digits and dashes, 8 to
 * 40 long, with a good run of digits. A record id such as a UUID is not one.
 */
const cleanNumber = (value: unknown): string => {
  const raw = text(value).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9-]{8,40}$/.test(raw)) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return "";
  return (raw.match(/\d/g) ?? []).length >= 6 ? raw : "";
};

const CARRIERS: { name: string; match: RegExp; link: (number: string) => string }[] = [
  { name: "USPS", match: /usps|postal service/i, link: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
  { name: "UPS", match: /\bups\b|united parcel/i, link: (n) => `https://www.ups.com/track?tracknum=${n}` },
  { name: "FedEx", match: /fedex|federal express/i, link: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  { name: "DHL", match: /\bdhl\b/i, link: (n) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}` },
];

/** A carrier's proper name and tracking page, when it is one of the big four. */
function knownCarrier(hint: string): (typeof CARRIERS)[number] | null {
  return CARRIERS.find((carrier) => carrier.match.test(hint)) ?? null;
}

function finish(found: { carrier: string; number: string; url: string }): Tracking | null {
  const number = cleanNumber(found.number);
  if (!number) return null;
  const known = knownCarrier(`${found.carrier} ${found.url}`);
  return {
    carrier: known?.name ?? text(found.carrier).slice(0, 60),
    number,
    url: safeUrl(found.url) || (known ? known.link(encodeURIComponent(number)) : ""),
  };
}

/** The list the Shipment Tracking and Advanced Shipment Tracking plugins keep. */
function fromTrackingItems(meta: Meta[]): Tracking | null {
  const items = meta.find((entry) => entry.key === "_wc_shipment_tracking_items")?.value;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const found = finish({
      carrier: text(row.custom_tracking_provider) || text(row.tracking_provider) || text(row.formatted_tracking_provider),
      number: text(row.tracking_number),
      url: text(row.custom_tracking_link) || text(row.formatted_tracking_link) || text(row.tracking_link),
    });
    if (found) return found;
  }
  return null;
}

/**
 * Loose fields, as many plugins write them: "_tracking_number", "tracking_url",
 * "_shipping_carrier", with or without the plugin's own name in front. Only whole
 * names of that shape count: "..._tracking_id" is usually a record, not a parcel.
 */
function fromLooseMeta(meta: Meta[]): Tracking | null {
  const field = (pattern: RegExp) =>
    text(meta.find((entry) => pattern.test(entry.key) && text(entry.value) !== "")?.value);
  return finish({
    number: field(/^_?([a-z0-9]+_){0,2}track(ing)?_(number|no|code)$/i),
    url: field(/^_?([a-z0-9]+_){0,2}track(ing)?_(url|link)$/i),
    carrier: field(/^_?([a-z0-9]+_){0,2}(carrier|courier|shipping_provider|tracking_provider|shipping_company)(_name)?$/i),
  });
}

/**
 * What follows the word "tracking" in a note and reads as a number: digits in
 * groups ("9400 1118 9922 31"), or one unbroken run of letters and digits. Plain
 * words don't count, so "tracking pending for ..." finds nothing.
 */
const IN_NOTE =
  /\btrack(?:ing)?(?:\s*(?:number|no\.?|code|info(?:rmation)?|id|#))?\s*(?:is|:|#|-)?\s*(\d{2,}(?:[ -]\d{2,}){1,9}|(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{8,40})/gi;

/** A note left on the order, like "Shipped with USPS. Tracking number: 9400...". */
function fromNotes(notes: string[]): Tracking | null {
  for (const raw of notes) {
    const decoded = raw.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
    const note = decoded.replace(/<[^>]*>/g, " ");
    if (!/track/i.test(note)) continue;
    // The link may only be in a tag's address, so it is looked for before tags are dropped.
    const link = /https:\/\/[^\s"'<>)]+/i.exec(decoded)?.[0]?.replace(/[.,;]+$/, "") ?? "";
    for (const match of note.matchAll(IN_NOTE)) {
      const found = finish({
        carrier: knownCarrier(note)?.name ?? "",
        number: match[1].replace(/[ -]+$/, ""),
        url: /track/i.test(link) ? link : "",
      });
      if (found) return found;
    }
  }
  return null;
}

/** The tracking details on an order, or null if none can be found. */
export function readTracking(meta: Meta[], notes: string[] = []): Tracking | null {
  return fromTrackingItems(meta) ?? fromLooseMeta(meta) ?? fromNotes(notes);
}
