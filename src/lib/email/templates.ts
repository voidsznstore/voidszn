import { type DiscountKind, discountLabel, linkWithCode } from "@/lib/discounts/describe";
import { formatMoney } from "@/lib/money";
import { siteConfig, unfilledSiteConfig } from "@/lib/site-config";

/**
 * The emails the store sends. Each returns a subject, an HTML body and a plain
 * text body that says the same thing.
 *
 * They look like the store: dark, the Eclipse logo up top, poster headlines, one
 * rust button. They are built the way email has to be built (tables, inline
 * styles, nothing a mail app might strip), and written for a phone first:
 * one column, the button early, and big enough to hit with a thumb.
 *
 * This file is also used in the browser, to preview campaigns, so it must not
 * import anything that only works on the server.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

/* ------------------------------------------------------------------ */
/* Look                                                                */
/* ------------------------------------------------------------------ */

const C = {
  page: "#0a0a0a",
  card: "#161514",
  cardEdge: "#302d2a",
  inset: "#0f0e0d",
  line: "#2b2826",
  white: "#ffffff",
  bone: "#edeae3",
  body: "#d0ccc4",
  smoke: "#a3a3a3",
  quiet: "#8a8784",
  /** The mailing address. There because the law asks, and no louder than that. */
  faint: "#5e5b58",
  rust: "#c4622d",
  ember: "#e58a55",
  onRust: "#120a05",
};

const SANS = "Arial, Helvetica, sans-serif";
/** Anton where the mail app loads fonts (Apple Mail, iOS). A heavy system face everywhere else. */
const DISPLAY = "Anton, Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace";

const LOGO = { url: `${siteConfig.url}/email/logo.png`, width: 180, height: 84 };

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "there";

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

/** A discount code as an email shows it. */
export type EmailDiscount = {
  code: string;
  type: DiscountKind;
  value: number;
  minOrderCents: number;
  expiresAt: Date | null;
  oncePerCustomer: boolean;
  /** True when it only works for someone who hasn't ordered before. */
  firstOrderOnly?: boolean;
  /** True when only so many uses are allowed in total. */
  limited?: boolean;
};

type Item = { name: string; detail: string; price: string; imageUrl?: string | null };

type Block =
  | { p: string }
  /** Smaller, quieter text: fine print, reassurance under a button. */
  | { note: string }
  | { button: { label: string; url: string } }
  | { rows: [string, string][]; totalRow?: [string, string] }
  | { lines: string[] }
  | { image: { url: string; alt: string } }
  | { items: Item[] }
  | { coupon: EmailDiscount }
  /** Label and value pairs in a box, e.g. carrier and tracking number. */
  | { facts: [string, string][] }
  | { rule: true };

/** A line at the foot of an email. A link is written out in full in the text version. */
type FootLine = string | { before: string; link: { label: string; url: string }; after?: string };

const expiryFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: siteConfig.timeZone,
  month: "long",
  day: "numeric",
});

/**
 * The last day a code can be used, in words. A code that ends at or soon after
 * midnight is over before that day begins, so it is given as the day before:
 * one ending at 12:00 AM on November 1 reads "October 31".
 */
function lastDay(expiresAt: Date): string {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  return expiryFormat.format(new Date(expiresAt.getTime() - SIX_HOURS));
}

/** The small print under a code: what it needs and when it ends. */
export function couponTerms(discount: EmailDiscount): string {
  const tidy = (cents: number) => formatMoney(cents).replace(/\.00$/, "");
  return [
    discount.minOrderCents > 0 ? `On orders over ${tidy(discount.minOrderCents)}.` : null,
    discount.firstOrderOnly ? "First order only." : discount.oncePerCustomer ? "One use per customer." : null,
    discount.limited ? "Limited number of uses." : null,
    discount.expiresAt ? `Ends ${lastDay(discount.expiresAt)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function renderBlock(block: Block, align: "center" | "left"): string {
  if ("p" in block) {
    return `<p style="margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body};text-align:${align};">${escape(block.p)}</p>`;
  }
  if ("note" in block) {
    return `<p style="margin:0 0 18px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.smoke};text-align:${align};">${escape(block.note)}</p>`;
  }
  if ("button" in block) {
    // A wide, tall target: the whole pill is the link.
    return `<table role="presentation" class="btn-t" cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 22px;"><tr><td align="center" bgcolor="${C.rust}" style="border-radius:999px;background:${C.rust};"><a href="${escape(block.button.url)}" class="btn" style="display:inline-block;min-width:220px;padding:19px 36px;font-family:${SANS};font-size:17px;line-height:20px;font-weight:bold;color:${C.onRust};text-decoration:none;text-align:center;border-radius:999px;border:1px solid #dd8a5c;">${escape(block.button.label)}</a></td></tr></table>`;
  }
  if ("lines" in block) {
    return `<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.body};text-align:${align};">${block.lines.map(escape).join("<br>")}</p>`;
  }
  if ("image" in block) {
    return `<p style="margin:0 0 24px;"><img src="${escape(block.image.url)}" alt="${escape(block.image.alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:16px;"></p>`;
  }
  if ("rule" in block) {
    return `<div style="height:1px;line-height:1px;font-size:1px;background:${C.line};margin:6px 0 22px;">&nbsp;</div>`;
  }
  if ("coupon" in block) {
    const terms = couponTerms(block.coupon);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;"><tr><td align="center" style="padding:26px 20px 24px;border:2px dashed ${C.rust};border-radius:20px;background:#1d1410;">
<div style="font-family:${DISPLAY};font-size:46px;line-height:48px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${C.ember};">${escape(discountLabel(block.coupon))}</div>
<div style="margin:14px 0 0;font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:${C.smoke};">Your code</div>
<div style="margin:8px 0 0;"><span style="display:inline-block;padding:11px 22px;border-radius:12px;background:${C.page};border:1px solid ${C.cardEdge};font-family:${MONO};font-size:22px;line-height:26px;font-weight:bold;letter-spacing:4px;color:${C.white};">${escape(block.coupon.code)}</span></div>
${terms ? `<div style="margin:14px 0 0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.smoke};">${escape(terms)}</div>` : ""}
</td></tr></table>`;
  }
  if ("facts" in block) {
    const rows = block.facts
      .map(
        ([label, value]) =>
          `<tr><td style="padding:5px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.smoke};">${escape(label)}</td><td align="right" style="padding:5px 0;font-family:${SANS};font-size:15px;line-height:20px;font-weight:bold;color:${C.bone};word-break:break-all;">${escape(value)}</td></tr>`,
      )
      .join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="padding:14px 18px;border-radius:14px;background:${C.inset};border:1px solid ${C.line};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
  }
  if ("items" in block) {
    const rows = block.items
      .map((item, index) => {
        const edge = index === 0 ? "" : `border-top:1px solid ${C.line};`;
        const picture = item.imageUrl
          ? `<td width="64" valign="top" style="padding:14px 14px 14px 0;${edge}"><img src="${escape(item.imageUrl)}" alt="" width="64" height="80" style="display:block;width:64px;height:80px;object-fit:cover;border:0;border-radius:10px;background:#242424;"></td>`
          : "";
        return `<tr>${picture}<td valign="middle" style="padding:14px 10px 14px 0;${edge}font-family:${SANS};"><div style="font-size:15px;line-height:21px;font-weight:bold;color:${C.bone};">${escape(item.name)}</div>${item.detail ? `<div style="font-size:13px;line-height:19px;color:${C.smoke};">${escape(item.detail)}</div>` : ""}</td><td valign="middle" align="right" style="padding:14px 0;${edge}font-family:${SANS};font-size:15px;line-height:21px;font-weight:bold;color:${C.white};white-space:nowrap;">${escape(item.price)}</td></tr>`;
      })
      .join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${rows}</table>`;
  }
  const cell = `padding:5px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${C.body};`;
  const rows = block.rows
    .map(
      ([label, value]) =>
        `<tr><td style="${cell}">${escape(label)}</td><td align="right" style="${cell}white-space:nowrap;">${escape(value)}</td></tr>`,
    )
    .join("");
  const total = block.totalRow
    ? `<tr><td style="${cell}padding-top:14px;border-top:1px solid ${C.line};font-weight:bold;color:${C.white};">${escape(block.totalRow[0])}</td><td align="right" style="${cell}padding-top:14px;border-top:1px solid ${C.line};font-size:20px;font-weight:bold;color:${C.white};white-space:nowrap;">${escape(block.totalRow[1])}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid ${C.line};padding-top:10px;">${rows}${total ? `<tr><td colspan="2" style="height:8px;line-height:8px;font-size:8px;">&nbsp;</td></tr>${total}` : ""}</table>`;
}

function textOf(block: Block): string | null {
  if ("p" in block) return block.p;
  if ("note" in block) return block.note;
  if ("button" in block) return `${block.button.label}: ${block.button.url}`;
  if ("lines" in block) return block.lines.join("\n");
  if ("image" in block || "rule" in block) return null;
  if ("coupon" in block) {
    const terms = couponTerms(block.coupon);
    return `${discountLabel(block.coupon)} with code ${block.coupon.code}${terms ? `\n${terms}` : ""}`;
  }
  if ("facts" in block) return block.facts.map(([label, value]) => `${label}: ${value}`).join("\n");
  if ("items" in block) {
    return block.items
      .map((item) => `${[item.name, item.detail].filter(Boolean).join(", ")}: ${item.price}`)
      .join("\n");
  }
  return [...block.rows, ...(block.totalRow ? [block.totalRow] : [])]
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/** Who sent it and where they are, for the very bottom. Anything not filled in yet is left out. */
function sender(): { name: string; address: string | null } {
  const unfilled = unfilledSiteConfig();
  return {
    name: unfilled.includes("legalName") ? siteConfig.name : siteConfig.legalName,
    address: unfilled.includes("mailingAddress") ? null : siteConfig.mailingAddress,
  };
}

type LayoutOptions = {
  /** Lines for the foot of the email, in place of the usual "questions?" line. */
  foot?: FootLine[];
  /** The line mail apps show next to the subject. Not shown in the email itself. */
  preheader?: string;
  /** A small tag above the headline, e.g. the order number. */
  tag?: string;
  /** Centered suits a short message with one button. Left suits an order's details. */
  align?: "center" | "left";
};

function layout(heading: string, blocks: Block[], options: LayoutOptions = {}): { html: string; text: string } {
  const align = options.align ?? "center";
  const html = blocks.map((block) => renderBlock(block, align)).join("\n");
  const text = blocks
    .map(textOf)
    .filter((part) => part !== null)
    .join("\n\n");

  const from = sender();
  const foot: FootLine[] = options.foot ?? [
    `Questions? Reply to this email or write to ${siteConfig.supportEmail}.`,
  ];
  const footHtml = foot
    .map((line) =>
      typeof line === "string"
        ? escape(line)
        : `${escape(line.before)}<a href="${escape(line.link.url)}" style="color:${C.smoke};text-decoration:underline;">${escape(line.link.label)}</a>${escape(line.after ?? "")}`,
    )
    .join("<br>");
  const footText = [
    ...foot.map((line) =>
      typeof line === "string" ? line : `${line.before}${line.link.label}: ${line.link.url}${line.after ?? ""}`,
    ),
    [from.name, from.address].filter(Boolean).join(" · "),
  ].join("\n");

  // Hidden text at the very top is what mail apps show as the preview line. The
  // run of blank characters after it stops the body text from being pulled in too.
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escape(options.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>\n`
    : "";
  const tag = options.tag
    ? `<div style="margin:0 0 16px;text-align:${align};"><span style="display:inline-block;padding:6px 14px;border-radius:999px;border:1px solid ${C.cardEdge};background:${C.inset};font-family:${SANS};font-size:12px;line-height:14px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.bone};">${escape(options.tag)}</span></div>`
    : "";

  return {
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escape(heading)}</title>
<style>
@font-face{font-family:Anton;font-style:normal;font-weight:100 900;src:url(${siteConfig.url}/email/anton.woff2) format("woff2");}
:root{color-scheme:dark;}
a{color:${C.bone};}
@media (max-width:480px){
  .card{padding:30px 22px 24px !important;border-radius:22px !important;}
  .h1{font-size:38px !important;line-height:40px !important;}
  .btn-t{width:100% !important;}
  .btn{display:block !important;min-width:0 !important;padding-left:20px !important;padding-right:20px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page};background-image:radial-gradient(640px 300px at 50% 0,rgba(196,98,45,0.30),rgba(10,10,10,0) 70%);">
<tr><td align="center" style="padding:28px 12px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td align="center" style="padding:0 0 22px;"><a href="${siteConfig.url}" style="text-decoration:none;"><img src="${LOGO.url}" alt="${escape(siteConfig.name)}" width="${LOGO.width}" height="${LOGO.height}" style="display:block;width:${LOGO.width}px;height:${LOGO.height}px;border:0;font-family:${DISPLAY};font-size:30px;font-weight:bold;letter-spacing:1px;color:${C.white};"></a></td></tr>
<tr><td class="card" bgcolor="${C.card}" style="padding:40px 40px 30px;background:${C.card};border:1px solid ${C.cardEdge};border-radius:26px;">
${tag}<h1 class="h1" style="margin:0 0 20px;font-family:${DISPLAY};font-size:46px;line-height:48px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;color:${C.white};text-align:${align};">${escape(heading)}</h1>
${html}
</td></tr>
<tr><td align="center" style="padding:24px 16px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.quiet};text-align:center;">${footHtml}</td></tr>
<tr><td align="center" style="padding:14px 16px 0;font-family:${SANS};font-size:10px;line-height:15px;color:${C.faint};text-align:center;">${escape(from.name)}${from.address ? `<br>${escape(from.address)}` : ""}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
    text: `${heading.toUpperCase()}\n\n${text}\n\n--\n${footText}`,
  };
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export type OrderEmailData = {
  orderNumber: string;
  customerName: string | null;
  items: {
    productName: string;
    colorName: string;
    size: string;
    quantity: number;
    unitPriceCents: number;
    imageUrl?: string | null;
  }[];
  discountCents: number;
  /** The code that was used, if any. */
  discountCode?: string | null;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingName: string;
  shippingAddress: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string };
  /** Collected or handed over, not shipped. */
  isPickup?: boolean;
  /** False for an order added by hand that hasn't been paid for yet. */
  isPaid?: boolean;
};

/** "Black / M", or whichever of the two an item has. Custom items may have neither. */
export const optionLabel = (item: { colorName: string; size: string }) =>
  [item.colorName, item.size].filter(Boolean).join(" / ");

const orderItems = (items: OrderEmailData["items"]): Item[] =>
  items.map((item) => ({
    name: `${item.productName}${item.quantity > 1 ? ` × ${item.quantity}` : ""}`,
    detail: optionLabel(item),
    price: formatMoney(item.unitPriceCents * item.quantity),
    imageUrl: item.imageUrl ?? null,
  }));

export function orderPlacedEmail(order: OrderEmailData): RenderedEmail {
  const { shipping, orders } = siteConfig;
  const address = order.shippingAddress;
  const freeShipping = !order.isPickup && order.shippingCents === 0;
  const blocks: Block[] = [
    {
      p: order.isPickup
        ? `Hi ${firstName(order.customerName)}, we have your order. Every item is printed to order, which takes ${shipping.productionDays} business days. We'll be in touch when it's ready.`
        : `Hi ${firstName(order.customerName)}, we have your order. Every item is printed to order, which takes ${shipping.productionDays} business days. Then it ships, and we email you the tracking.`,
    },
    { items: orderItems(order.items) },
    {
      rows: [
        ...(order.discountCents > 0
          ? [[`Discount${order.discountCode ? ` (${order.discountCode})` : ""}`, `-${formatMoney(order.discountCents)}`] as [string, string]]
          : []),
        ...(order.isPickup && order.shippingCents === 0
          ? []
          : [[
              `Shipping${freeShipping && order.discountCode ? ` (${order.discountCode})` : ""}`,
              freeShipping ? "Free" : formatMoney(order.shippingCents),
            ] as [string, string]]),
        ...(order.taxCents > 0 ? [["Tax", formatMoney(order.taxCents)] as [string, string]] : []),
      ],
      totalRow: [order.isPaid === false ? "Total due" : "Total", formatMoney(order.totalCents)],
    },
  ];
  if (address.line1) {
    blocks.push({
      lines: [
        "Shipping to",
        order.shippingName,
        address.line1,
        ...(address.line2 ? [address.line2] : []),
        `${address.city}, ${address.state} ${address.postalCode}`,
      ],
    });
  }
  blocks.push({
    note: `Need to change or cancel? Reply to this email within ${orders.cancelWindow} of ordering. If anything arrives damaged or wrong, tell us within ${orders.issueWindowDays} days and we'll replace or refund it.`,
  });
  return {
    subject: `Order ${order.orderNumber} confirmed`,
    ...layout("Order confirmed", blocks, {
      align: "left",
      tag: `Order ${order.orderNumber}`,
      preheader: `Thanks, ${firstName(order.customerName)}. Printing starts now. Total ${formatMoney(order.totalCents)}.`,
    }),
  };
}

export function orderShippedEmail(order: {
  orderNumber: string;
  customerName: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}): RenderedEmail {
  const blocks: Block[] = [
    {
      p: `Hi ${firstName(order.customerName)}, your order is printed, packed and on its way. Standard shipping takes ${siteConfig.shipping.transitDays} business days.`,
    },
  ];
  if (order.trackingUrl) blocks.push({ button: { label: "Track my order", url: order.trackingUrl } });
  const facts: [string, string][] = [
    ...(order.carrier ? [["Carrier", order.carrier] as [string, string]] : []),
    ...(order.trackingNumber ? [["Tracking number", order.trackingNumber] as [string, string]] : []),
  ];
  if (facts.length > 0) blocks.push({ facts });
  blocks.push({ note: "Tracking can take a day to start showing movement." });
  return {
    subject: `Your order ${order.orderNumber} has shipped`,
    ...layout("On its way", blocks, {
      tag: `Order ${order.orderNumber}`,
      preheader: order.trackingNumber
        ? `Tracking number ${order.trackingNumber}. Tap to follow it.`
        : "Printed, packed and with the carrier.",
    }),
  };
}

/**
 * Sent when an order is marked delivered. With a code set in the admin, it also
 * says thanks with money off the next order.
 */
export function orderDeliveredEmail(order: {
  orderNumber: string;
  customerName: string | null;
  discount?: EmailDiscount | null;
  /** Needed with a code: an offer has to come with a way to stop getting offers. */
  unsubscribeUrl?: string | null;
}): RenderedEmail {
  const { orders } = siteConfig;
  const shop = `${siteConfig.url}/collections/just-in`;
  const blocks: Block[] = [
    {
      p: `Hi ${firstName(order.customerName)}, the carrier says your order has arrived. We hope it's exactly what you pictured.`,
    },
  ];
  if (order.discount) {
    blocks.push(
      {
        p:
          order.discount.type === "FREE_SHIPPING"
            ? "Shipping is on us for your next one, as a thank you."
            : "Here's something off your next one, as a thank you.",
      },
      { coupon: order.discount },
      { button: { label: `Use my ${discountLabel(order.discount).toLowerCase()}`, url: linkWithCode(shop, order.discount.code, siteConfig.url) } },
      { note: "The button adds the code for you." },
      { rule: true },
    );
  }
  blocks.push({
    note: `Something not right? Reply to this email within ${orders.issueWindowDays} days with a photo and we'll replace or refund it.`,
  });
  // "20% off your next order", but "free shipping on your next order".
  const offer = order.discount
    ? `${discountLabel(order.discount).toLowerCase()}${order.discount.type === "FREE_SHIPPING" ? " on" : ""} your next order`
    : null;
  return {
    subject: offer ? `Delivered. Here's ${offer}` : `Your order ${order.orderNumber} was delivered`,
    ...layout("It's here", blocks, {
      tag: `Order ${order.orderNumber}`,
      preheader: order.discount
        ? `Thanks for ordering. ${discountLabel(order.discount)} with code ${order.discount.code}.`
        : "Your order has arrived. Anything wrong? Just reply.",
      ...(order.discount && order.unsubscribeUrl
        ? {
            foot: [
              `Questions? Reply to this email or write to ${siteConfig.supportEmail}.`,
              {
                before: "Don't want offers with your order emails? ",
                link: { label: "Unsubscribe", url: order.unsubscribeUrl },
                after: ".",
              },
            ],
          }
        : {}),
    }),
  };
}

export function orderRefundedEmail(order: {
  orderNumber: string;
  customerName: string | null;
  amountCents: number;
  isFullRefund: boolean;
}): RenderedEmail {
  const amount = formatMoney(order.amountCents);
  return {
    subject: `Refund for order ${order.orderNumber}`,
    ...layout(
      "Refund sent",
      [
        {
          p: `Hi ${firstName(order.customerName)}, we've refunded ${amount}${order.isFullRefund ? "" : ", part of your order total"}.`,
        },
        { facts: [["Refunded", amount], ["Order", order.orderNumber]] },
        {
          note: `It goes back to the card or account you paid with. Banks usually take up to ${siteConfig.orders.refundDays} business days to show it.`,
        },
      ],
      { tag: `Order ${order.orderNumber}`, preheader: `${amount} is on its way back to you.` },
    ),
  };
}

export function orderCancelledEmail(order: {
  orderNumber: string;
  customerName: string | null;
  /** Whether money had been taken for the order. Refunds are sent separately. */
  wasPaid: boolean;
}): RenderedEmail {
  return {
    subject: `Order ${order.orderNumber} was cancelled`,
    ...layout(
      "Order cancelled",
      [
        {
          p: `Hi ${firstName(order.customerName)}, your order has been cancelled and won't be printed or shipped.`,
        },
        {
          note: order.wasPaid
            ? `If you paid, the refund is sent separately and you'll get an email when it is. Banks usually take up to ${siteConfig.orders.refundDays} business days to show it.`
            : "Nothing was charged.",
        },
        { button: { label: "Back to the store", url: siteConfig.url } },
        { note: "Didn't ask for this? Reply to this email and we'll sort it out." },
      ],
      { tag: `Order ${order.orderNumber}`, preheader: "It won't be printed or shipped." },
    ),
  };
}

export function passwordResetEmail(input: { name: string; url: string; minutes: number }): RenderedEmail {
  return {
    subject: `Reset your ${siteConfig.name} admin password`,
    ...layout(
      "Reset your password",
      [
        { p: `Hi ${firstName(input.name)}, someone asked to reset the password for your ${siteConfig.name} admin account.` },
        { button: { label: "Choose a new password", url: input.url } },
        { note: `The link works once and expires in ${input.minutes} minutes. You'll still need your authenticator app to sign in.` },
        { note: "If this wasn't you, ignore this email. Your password stays as it is." },
      ],
      { preheader: `The link expires in ${input.minutes} minutes.` },
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

export type CampaignContent = {
  subject: string;
  preheader: string;
  /** The big line at the top. The subject is used when this is empty. */
  heading?: string | null;
  /** Plain text. A blank line starts a new paragraph. */
  body: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
  /** A code to show in the email. The button applies it for whoever taps through. */
  discount?: EmailDiscount | null;
};

/** What every marketing email must carry: why you got it and a way to stop. The address follows by itself. */
const marketingFoot = (unsubscribeUrl: string, reason: string): FootLine[] => [
  reason,
  { before: "Don't want these? ", link: { label: "Unsubscribe", url: unsubscribeUrl }, after: "." },
];

const reassurance = () =>
  `Printed to order. If it arrives damaged or wrong, we replace or refund it within ${siteConfig.orders.issueWindowDays} days.`;

/**
 * A marketing email. In order: picture, headline, a few lines, the code if there
 * is one, then one button. The foot carries what the law asks for in every one:
 * who sent it, a postal address and a way to stop getting them.
 */
export function campaignEmail(content: CampaignContent, unsubscribeUrl: string): RenderedEmail {
  const blocks: Block[] = [];
  if (content.imageUrl) blocks.push({ image: { url: content.imageUrl, alt: "" } });
  for (const paragraph of content.body.split(/\n\s*\n/)) {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 1) blocks.push({ p: lines[0] });
    else if (lines.length > 1) blocks.push({ lines });
  }
  const discount = content.discount ?? null;
  if (discount) blocks.push({ coupon: discount });

  const label = content.buttonLabel.trim();
  const url = content.buttonUrl.trim();
  if (label && url) {
    const withCode = linkWithCode(url, discount?.code ?? null, siteConfig.url);
    blocks.push({ button: { label, url: withCode } });
    // Only true for links into the store. A button going elsewhere can't carry a code.
    if (discount && withCode !== url) blocks.push({ note: "The button adds the code for you." });
    blocks.push({ note: reassurance() });
  }

  return {
    subject: content.subject,
    ...layout(content.heading?.trim() || content.subject, blocks, {
      preheader: content.preheader.trim() || undefined,
      foot: marketingFoot(unsubscribeUrl, `You're getting this because you agreed to emails from ${siteConfig.name}.`),
    }),
  };
}

export type CartEmailItem = {
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl: string | null;
};

/**
 * A reminder about a cart someone started to pay for. There are three, each with
 * its own job: a nudge soon after, answers to the usual worries the next day,
 * and a last call a few days on. Any of them can carry a discount code.
 */
export function cartReminderEmail(input: {
  /** Which reminder: 1, 2 or 3. */
  step: 1 | 2 | 3;
  items: CartEmailItem[];
  /** Takes them back to checkout with the cart refilled. */
  restoreUrl: string;
  discount?: EmailDiscount | null;
  unsubscribeUrl: string;
}): RenderedEmail {
  const { shipping, orders } = siteConfig;
  const discount = input.discount ?? null;
  const offer = discount ? discountLabel(discount) : null;
  const count = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const first = input.items[0]?.name ?? "Your pick";
  const what = count > 1 ? `${first} and ${count - 1} more` : first;
  const url = linkWithCode(input.restoreUrl, discount?.code ?? null, siteConfig.url);

  const items: Block = {
    items: input.items.map((item) => ({
      name: `${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ""}`,
      detail: [item.color, item.size].filter(Boolean).join(" / "),
      price: formatMoney(item.unitPriceCents * item.quantity),
      imageUrl: item.imageUrl,
    })),
  };

  const copy = {
    1: {
      subject: offer ? `Your cart is saved, with ${offer.toLowerCase()}` : "You left something behind",
      preheader: `${what} is still in your cart. One tap and you're back at checkout.`,
      heading: "Still thinking it over?",
      intro: "Your cart is saved, right where you left it.",
      button: offer ? `Finish with ${offer.toLowerCase()}` : "Finish my order",
    },
    2: {
      subject: offer ? `${offer} if you finish your order` : "Your cart is still here",
      preheader: `Printed for you in ${shipping.productionDays} business days. Wrong or damaged? Replaced or refunded.`,
      heading: "Made when you order",
      intro: `Nothing sits in a warehouse. Yours is printed for you in ${shipping.productionDays} business days, then shipped with tracking.`,
      button: offer ? `Claim ${offer.toLowerCase()}` : "Go back to my cart",
    },
    3: {
      subject: offer ? `Last call: ${offer.toLowerCase()} on your cart` : "Last call for your cart",
      preheader: "This is the last reminder. After this we let it go.",
      heading: "Last call",
      intro: "This is the last reminder about your cart. After this we clear it.",
      button: offer ? `Use my ${offer.toLowerCase()}` : "Finish my order",
    },
  }[input.step];

  const blocks: Block[] = [{ p: copy.intro }, { button: { label: copy.button, url } }, items];
  if (discount) blocks.push({ coupon: discount }, { note: "The button adds the code for you." });
  if (input.step > 1) {
    // Further down for anyone who read this far: the same button again.
    blocks.push({ button: { label: copy.button, url } });
  }
  blocks.push({
    note: `Every item is printed to order. If it arrives damaged or wrong, we replace or refund it within ${orders.issueWindowDays} days.`,
  });

  return {
    subject: copy.subject,
    ...layout(copy.heading, blocks, {
      preheader: copy.preheader,
      foot: marketingFoot(
        input.unsubscribeUrl,
        `You're getting this because you started checking out at ${siteConfig.name}.`,
      ),
    }),
  };
}

/* ------------------------------------------------------------------ */
/* The team                                                            */
/* ------------------------------------------------------------------ */

export function adminInviteEmail(input: {
  name: string;
  invitedBy: string;
  url: string;
  days: number;
}): RenderedEmail {
  return {
    subject: `You've been added to the ${siteConfig.name} dashboard`,
    ...layout(
      "Join the team",
      [
        {
          p: `Hi ${firstName(input.name)}, ${input.invitedBy} has added you to the ${siteConfig.name} dashboard: orders, customers, the inbox, campaigns, the books and your payouts.`,
        },
        { button: { label: "Set your name and password", url: input.url } },
        {
          note: `The link works once and expires in ${input.days} days. After your password you'll set up an authenticator app (Google Authenticator or any other), so have your phone handy.`,
        },
        { note: "If you weren't expecting this, ignore this email. Nothing happens unless the link is used." },
      ],
      { preheader: `Set your password to get in. The link lasts ${input.days} days.` },
    ),
  };
}

/** To the master account: a partner has cashed out and the money needs sending. */
export function payoutRequestedEmail(input: {
  partner: string;
  amount: string;
  sendTo: string | null;
  url: string;
  /** Why it couldn't go straight to their card, when card payouts are on. */
  problem?: string;
}): RenderedEmail {
  return {
    subject: `${input.partner} cashed out ${input.amount}`,
    ...layout(
      "Payout to send",
      [
        { p: `${input.partner} has cashed out ${input.amount}. It has come off their balance and is waiting to be sent.` },
        ...(input.problem ? [{ note: `It couldn't go to their card: ${input.problem}` } as const] : []),
        {
          facts: [
            ["Amount", input.amount],
            ["Send to", input.sendTo ?? "Not set. Ask them where to send it."],
          ],
        },
        { button: { label: "Open payouts", url: input.url } },
        {
          note: input.problem
            ? "Fix what stopped it and press Send to card, or send it another way and mark it as sent."
            : "Once the money has gone, mark the payout as sent so they can see it.",
        },
      ],
      { preheader: `${input.amount} to send.` },
    ),
  };
}

/** To a partner: their cash-out has been sent. */
export function payoutSentEmail(input: { name: string; amount: string; note: string | null; url: string }): RenderedEmail {
  return {
    subject: `Your ${input.amount} payout has been sent`,
    ...layout(
      "Payout sent",
      [
        { p: `Hi ${firstName(input.name)}, your payout of ${input.amount} has been sent.` },
        ...(input.note ? [{ note: input.note } as const] : []),
        { button: { label: "See your payouts", url: input.url } },
      ],
      { preheader: `${input.amount} is on its way.` },
    ),
  };
}

/** To the partner and the master account: a card payout bounced and the money is back on the balance. */
export function payoutFailedEmail(input: { partner: string; amount: string; reason: string; url: string }): RenderedEmail {
  return {
    subject: `${input.amount} card payout didn't go through`,
    ...layout(
      "Payout not sent",
      [
        { p: `The ${input.amount} card payout to ${input.partner} didn't go through. Nothing was lost: the money is back on the balance and can be cashed out again.` },
        { facts: [["Why", input.reason]] },
        { button: { label: "Open payouts", url: input.url } },
        { note: "If it keeps failing, check the card in Stripe: it has to be a debit card that isn't prepaid." },
      ],
      { preheader: "The money is back on the balance." },
    ),
  };
}
