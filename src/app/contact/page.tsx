import type { Metadata } from "next";
import Link from "next/link";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach us about an order, a problem or anything else.",
};

export default function ContactPage() {
  const { legalName, mailingAddress, supportEmail, legalEmail, orders } = siteConfig;

  return (
    <InfoPage title="Contact" intro="We read every message and reply as soon as we can.">
      <h2>Email us</h2>
      <p>
        <Email address={supportEmail} />
      </p>

      <h2>About an order</h2>
      <p>To get a faster answer, include:</p>
      <ul>
        <li>your order number,</li>
        <li>the email address you ordered with, and</li>
        <li>a photo, if something arrived damaged or wrong.</li>
      </ul>
      <p>
        Need to cancel or fix an address? Email within {orders.cancelWindow} of ordering. Many
        answers are already on the <Link href="/faq">FAQ</Link>,{" "}
        <Link href="/shipping">Shipping</Link> and <Link href="/returns">Returns</Link> pages.
      </p>

      <h2>Rights and legal notices</h2>
      <p>
        To report a design, see <Link href="/ip-policy">IP and Publicity Rights</Link> or email{" "}
        <Email address={legalEmail} />.
      </p>

      <h2>Mail</h2>
      <p>
        {legalName}
        <br />
        {mailingAddress}
      </p>
    </InfoPage>
  );
}
