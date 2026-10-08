import type { Metadata } from "next";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Returns",
  description: "What we replace or refund, what we can't take back, and how to cancel an order.",
};

export default function ReturnsPage() {
  const { orders, supportEmail } = siteConfig;

  return (
    <InfoPage
      title="Returns"
      intro="Everything is made to order, so returns work differently here than at a store with shelves."
      policy
    >
      <h2>What we fix</h2>
      <p>
        Tell us within {orders.issueWindowDays} days of delivery and we will replace the item or
        refund it, your choice, if:
      </p>
      <ul>
        <li>it arrived damaged,</li>
        <li>it has a defect or the print is wrong or flawed, or</li>
        <li>you received the wrong item, size or color.</li>
      </ul>

      <h2>What we can&apos;t take back</h2>
      <p>
        Each item is printed for the person who ordered it and can&apos;t be resold. For that
        reason we don&apos;t accept returns or exchanges because you changed your mind or picked
        the wrong size. Please check the size chart on the product page before you order.
      </p>

      <h2>How to report a problem</h2>
      <ol>
        <li>
          Email <Email address={supportEmail} /> within {orders.issueWindowDays} days of the
          delivery date.
        </li>
        <li>Include your order number and a clear photo of the problem.</li>
        <li>
          We reply with the fix. If we need the item back, we send a prepaid return label. Please
          don&apos;t send anything back before we ask.
        </li>
      </ol>

      <h2>Refunds</h2>
      <p>
        Approved refunds go back to your original payment method within {orders.refundDays}{" "}
        business days. Your bank may take a few more days to show it.
      </p>

      <h2>Cancelling or changing an order</h2>
      <p>
        You can cancel or change an order within {orders.cancelWindow} of placing it by emailing{" "}
        <Email address={supportEmail} />. After that it is in production and can&apos;t be changed
        or cancelled.
      </p>
    </InfoPage>
  );
}
