import type { Metadata } from "next";
import Link from "next/link";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Shipping",
  description: "How long orders take to make and deliver, and what happens if one is late.",
};

export default function ShippingPage() {
  const { shipping, orders, supportEmail } = siteConfig;

  return (
    <InfoPage
      title="Shipping"
      intro="Every item is printed after you order it. Here is how long that takes and what to expect."
      policy
    >
      <h2>Where we ship</h2>
      <p>We ship to addresses in {shipping.regions}. Some P.O. boxes may not be deliverable.</p>

      <h2>How long it takes</h2>
      <ul>
        <li>
          <strong>Production:</strong> {shipping.productionDays} business days to print and pack
          your order.
        </li>
        <li>
          <strong>Standard shipping:</strong> {shipping.transitDays} business days in transit
          after it ships.
        </li>
      </ul>
      <p>
        Business days are Monday to Friday and exclude public holidays. Delivery times are
        estimates from the carrier, not guarantees.
      </p>

      <h2>Shipping cost</h2>
      <p>
        Shipping is calculated at checkout from what you order and where it is going. You see the
        full cost before you pay.
      </p>

      <h2>Tracking</h2>
      <p>
        We email a tracking number as soon as your order is handed to the carrier. Tracking can
        take up to a day to start updating.
      </p>

      <h2>If your order is late</h2>
      <p>
        If we can&apos;t ship your order within the production time above, we will email you with
        a new date. You can then wait, or cancel for a full refund. If we don&apos;t hear from you
        and can&apos;t ship by the new date, we cancel the order and refund you.
      </p>

      <h2>Wrong address</h2>
      <p>
        Check your address before you pay. You can correct it within {orders.cancelWindow} of
        ordering by emailing <Email address={supportEmail} />. After that the order is in
        production and the address can&apos;t be changed. If a package comes back to us because
        the address was wrong, we will contact you about reshipping it at your cost.
      </p>

      <h2>Lost or damaged packages</h2>
      <p>
        If tracking shows delivered and you can&apos;t find it, or the package arrives damaged,
        email <Email address={supportEmail} /> within {orders.issueWindowDays} days of the
        delivery date with your order number. See <Link href="/returns">Returns</Link> for how we
        fix it.
      </p>
    </InfoPage>
  );
}
