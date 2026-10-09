import { formatMoney } from "@/lib/money";
import { siteConfig, unfilledSiteConfig } from "@/lib/site-config";

/**
 * The emails the store sends. Each returns a subject, an HTML body and a plain
 * text body that says the same thing. Kept plain on purpose: light background,
 * no images, so they look right in every mail app and are quick to read.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

type Block =
  | { p: string }
  | { button: { label: string; url: string } }
  | { rows: [string, string][]; totalRow?: [string, string] }
  | { lines: string[] }
  | { image: { url: string; alt: string } };

/** A line at the foot of an email. A link is written out in full in the text version. */
type FootLine = string | { before: string; link: { label: string; url: string }; after?: string };

/** Business details for the foot of every email. Anything not filled in yet is left out. */
function footer(): string[] {
  const unfilled = unfilledSiteConfig();
  return [
    `Questions? Reply to this email or write to ${siteConfig.supportEmail}.`,
    [
      unfilled.includes("legalName") ? siteConfig.name : siteConfig.legalName,
      unfilled.includes("mailingAddress") ? null : siteConfig.mailingAddress,
    ]
      .filter(Boolean)
      .join(" · "),
  ];
}

function layout(
  heading: string,
  blocks: Block[],
  options: {
    /** Replaces the usual foot of the email. */
    foot?: FootLine[];
    /** The line mail apps show next to the subject. Not shown in the email itself. */
    preheader?: string;
  } = {},
): { html: string; text: string } {
  const cell = "padding:6px 0;font-size:15px;line-height:22px;color:#333333;";
  const html = blocks
    .map((block) => {
      if ("p" in block) {
        return `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#333333;">${escape(block.p)}</p>`;
      }
      if ("button" in block) {
        return `<p style="margin:8px 0 24px;"><a href="${escape(block.button.url)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 24px;">${escape(block.button.label)}</a></p>`;
      }
      if ("lines" in block) {
        return `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#333333;">${block.lines.map(escape).join("<br>")}</p>`;
      }
      if ("image" in block) {
        return `<p style="margin:0 0 20px;"><img src="${escape(block.image.url)}" alt="${escape(block.image.alt)}" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;"></p>`;
      }
      const rows = block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="${cell}">${escape(label)}</td><td align="right" style="${cell}white-space:nowrap;">${escape(value)}</td></tr>`,
        )
        .join("");
      const total = block.totalRow
        ? `<tr><td style="${cell}border-top:1px solid #dddddd;font-weight:bold;color:#111111;">${escape(block.totalRow[0])}</td><td align="right" style="${cell}border-top:1px solid #dddddd;font-weight:bold;color:#111111;">${escape(block.totalRow[1])}</td></tr>`
        : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">${rows}${total}</table>`;
    })
    .join("\n");

  const text = blocks
    .map((block) => {
      if ("p" in block) return block.p;
      if ("button" in block) return `${block.button.label}: ${block.button.url}`;
      if ("lines" in block) return block.lines.join("\n");
      if ("image" in block) return null;
      return [...block.rows, ...(block.totalRow ? [block.totalRow] : [])]
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n");
    })
    .filter((part) => part !== null)
    .join("\n\n");

  const foot = options.foot ?? footer();
  const footHtml = foot
    .map((line) =>
      typeof line === "string"
        ? escape(line)
        : `${escape(line.before)}<a href="${escape(line.link.url)}" style="color:#777777;text-decoration:underline;">${escape(line.link.label)}</a>${escape(line.after ?? "")}`,
    )
    .join("<br>");
  const footText = foot
    .map((line) =>
      typeof line === "string" ? line : `${line.before}${line.link.label}: ${line.link.url}${line.after ?? ""}`,
    )
    .join("\n");
  // Hidden text at the very top is what mail apps show as the preview line.
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(options.preheader)}</div>\n`
    : "";
  return {
    html: `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f4f2;">
${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="padding:24px 28px;background:#0a0a0a;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:2px;">${escape(siteConfig.name)}</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 20px;font-size:24px;line-height:30px;color:#111111;">${escape(heading)}</h1>
${html}
</td></tr>
<tr><td style="padding:20px 28px;border-top:1px solid #eeeeee;font-size:13px;line-height:20px;color:#777777;">${footHtml}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
    text: `${heading}\n\n${text}\n\n--\n${footText}`,
  };
}

/* ------------------------------------------------------------------ */

export type OrderEmailData = {
  orderNumber: string;
  customerName: string | null;
  items: { productName: string; colorName: string; size: string; quantity: number; unitPriceCents: number }[];
  discountCents: number;
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

export function orderPlacedEmail(order: OrderEmailData): RenderedEmail {
  const { shipping, orders } = siteConfig;
  const address = order.shippingAddress;
  const blocks: Block[] = [
    { p: `Hi ${firstName(order.customerName)}, thanks for your order. Here's what we have.` },
    { p: `Order number: ${order.orderNumber}` },
    {
      rows: [
        ...order.items.map((item): [string, string] => [
          `${[item.productName, optionLabel(item)].filter(Boolean).join(", ")}${item.quantity > 1 ? ` × ${item.quantity}` : ""}`,
          formatMoney(item.unitPriceCents * item.quantity),
        ]),
        ...(order.discountCents > 0
          ? [["Discount", `-${formatMoney(order.discountCents)}`] as [string, string]]
          : []),
        ...(order.isPickup && order.shippingCents === 0
          ? []
          : [["Shipping", formatMoney(order.shippingCents)] as [string, string]]),
        ...(order.taxCents > 0 ? [["Tax", formatMoney(order.taxCents)] as [string, string]] : []),
      ],
      totalRow: [order.isPaid === false ? "Total due" : "Total", formatMoney(order.totalCents)],
    },
  ];
  if (address.line1) {
    blocks.push({
      lines: [
        "Shipping to:",
        order.shippingName,
        address.line1,
        ...(address.line2 ? [address.line2] : []),
        `${address.city}, ${address.state} ${address.postalCode}`,
      ],
    });
  }
  blocks.push(
    {
      p: order.isPickup
        ? `Every item is printed to order. Printing and packing takes ${shipping.productionDays} business days. We'll be in touch when it's ready.`
        : `Every item is printed to order. Printing and packing takes ${shipping.productionDays} business days, then standard shipping takes ${shipping.transitDays} business days. We'll email you tracking when it ships.`,
    },
    {
      p: `Need to change or cancel? Reply to this email within ${orders.cancelWindow} of ordering. If anything arrives damaged or wrong, tell us within ${orders.issueWindowDays} days and we'll replace or refund it.`,
    },
  );
  return {
    subject: `Your ${siteConfig.name} order ${order.orderNumber}`,
    ...layout("Thanks for your order", blocks),
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
    { p: `Hi ${firstName(order.customerName)}, your order ${order.orderNumber} is on its way.` },
  ];
  const details = [
    order.carrier ? `Carrier: ${order.carrier}` : null,
    order.trackingNumber ? `Tracking number: ${order.trackingNumber}` : null,
  ].filter((line) => line !== null);
  if (details.length > 0) blocks.push({ lines: details });
  if (order.trackingUrl) blocks.push({ button: { label: "Track your order", url: order.trackingUrl } });
  blocks.push({
    p: `Standard shipping takes ${siteConfig.shipping.transitDays} business days. Tracking can take a day to start showing movement.`,
  });
  return {
    subject: `Your ${siteConfig.name} order ${order.orderNumber} has shipped`,
    ...layout("Your order has shipped", blocks),
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
    subject: `Refund for your ${siteConfig.name} order ${order.orderNumber}`,
    ...layout("Your refund is on its way", [
      {
        p: `Hi ${firstName(order.customerName)}, we've refunded ${amount} for order ${order.orderNumber}${order.isFullRefund ? "" : " (part of the order total)"}.`,
      },
      {
        p: `It goes back to the card or account you paid with. Banks usually take up to ${siteConfig.orders.refundDays} business days to show it.`,
      },
    ]),
  };
}

export function passwordResetEmail(input: { name: string; url: string; minutes: number }): RenderedEmail {
  return {
    subject: `Reset your ${siteConfig.name} admin password`,
    ...layout("Reset your password", [
      { p: `Hi ${firstName(input.name)}, someone asked to reset the password for your ${siteConfig.name} admin account.` },
      { button: { label: "Choose a new password", url: input.url } },
      { p: `The link works once and expires in ${input.minutes} minutes. You'll still need your authenticator app to sign in.` },
      { p: "If this wasn't you, ignore this email. Your password stays as it is." },
    ]),
  };
}

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

export type CampaignContent = {
  subject: string;
  preheader: string;
  /** Plain text. A blank line starts a new paragraph. */
  body: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
};

/**
 * A marketing email. The foot carries what the law asks for in every one: who
 * sent it, a postal address and a way to stop getting them.
 */
export function campaignEmail(content: CampaignContent, unsubscribeUrl: string): RenderedEmail {
  const blocks: Block[] = [];
  if (content.imageUrl) blocks.push({ image: { url: content.imageUrl, alt: "" } });
  for (const paragraph of content.body.split(/\n\s*\n/)) {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 1) blocks.push({ p: lines[0] });
    else if (lines.length > 1) blocks.push({ lines });
  }
  if (content.buttonLabel.trim() && content.buttonUrl.trim()) {
    blocks.push({ button: { label: content.buttonLabel.trim(), url: content.buttonUrl.trim() } });
  }

  const unfilled = unfilledSiteConfig();
  const sender = [
    unfilled.includes("legalName") ? siteConfig.name : siteConfig.legalName,
    unfilled.includes("mailingAddress") ? null : siteConfig.mailingAddress,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    subject: content.subject,
    ...layout(content.subject, blocks, {
      preheader: content.preheader.trim() || undefined,
      foot: [
        `You're getting this because you agreed to emails from ${siteConfig.name}.`,
        { before: "Don't want them? ", link: { label: "Unsubscribe", url: unsubscribeUrl }, after: "." },
        sender,
      ],
    }),
  };
}
