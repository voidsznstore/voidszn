import type { Metadata } from "next";
import Link from "next/link";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply when you use this site or place an order.",
};

export default function TermsPage() {
  const { name, legalName, mailingAddress, supportEmail, governingState, orders } = siteConfig;

  return (
    <InfoPage
      title="Terms of Service"
      intro="The agreement between you and us when you use this site or place an order."
      policy
    >
      <p>
        {name} is operated by {legalName} (&quot;we&quot;, &quot;us&quot;). By using this site or
        placing an order you agree to these terms. If you don&apos;t agree, please don&apos;t use
        the site.
      </p>

      <h2>Who can order</h2>
      <p>
        You must be at least 18, or have a parent or guardian place the order for you. You agree to
        give accurate contact, shipping and payment details.
      </p>

      <h2>Products</h2>
      <p>
        Every item is made to order. We do our best to show colors and prints accurately, but
        screens vary, and print placement and garment measurements can differ slightly from one
        item to the next.
      </p>

      <h2>Prices and tax</h2>
      <p>
        Prices are in US dollars and can change at any time, but never for an order you have
        already placed. Shipping and any sales tax are shown at checkout before you pay. If an item
        is listed at the wrong price by mistake, we may cancel the order and refund you in full.
      </p>

      <h2>Orders</h2>
      <p>
        Your order is an offer to buy. We accept it when we send it to production. We may decline or
        cancel an order, for example if we suspect fraud or can&apos;t make the item, and we will
        refund anything you paid. You can cancel within {orders.cancelWindow} of ordering.
      </p>

      <h2>Shipping and returns</h2>
      <p>
        Our <Link href="/shipping">Shipping</Link> and <Link href="/returns">Returns</Link> pages
        are part of these terms.
      </p>

      <h2>Discount codes</h2>
      <p>
        Codes have no cash value, can&apos;t be combined unless we say so, and may have limits or
        end dates. We can cancel a code that is being misused.
      </p>

      <h2>Reviews and photos you send us</h2>
      <p>
        If you submit a review or photo, you confirm it is yours and honest, and you give us
        permission to display it on the site and in our marketing. We may decline or remove
        submissions.
      </p>

      <h2>Our content</h2>
      <p>
        The designs, images, text and logo on this site belong to us or our licensors. You may not
        copy, reproduce or resell them without written permission. To report content you believe
        infringes your rights, see our{" "}
        <Link href="/ip-policy">IP and Publicity Rights</Link> page.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use the site to break the law, commit fraud, interfere with how it works, scrape
        it in bulk, or try to access accounts or data that aren&apos;t yours.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The site is provided as it is. To the extent the law allows, we make no warranties beyond
        those stated in these terms and our Returns page. Nothing here limits rights you have under
        consumer protection law that can&apos;t be waived.
      </p>

      <h2>Limit of liability</h2>
      <p>
        To the extent the law allows, our total liability for any claim about an order is limited
        to the amount you paid for that order, and we are not liable for indirect or consequential
        losses.
      </p>

      <h2>Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of {governingState}, United States. If you have a
        problem, email us first and we will try to resolve it. If we can&apos;t, disputes are
        handled by the state or federal courts located in {governingState}.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. The version in effect when you place an order is the one that
        applies to that order.
      </p>

      <h2>Contact</h2>
      <p>
        {legalName}
        <br />
        {mailingAddress}
        <br />
        <Email address={supportEmail} />
      </p>
    </InfoPage>
  );
}
