import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/site/info-page";

export const metadata: Metadata = {
  title: "Size Guide",
  description: "How to measure a shirt you own and pick the right size.",
};

export default function SizeGuidePage() {
  return (
    <InfoPage
      title="Size Guide"
      intro="Garments differ, so each product page has its own size chart. Here is how to use it."
    >
      <h2>Measure a shirt you already like</h2>
      <p>
        The most reliable way to pick a size is to compare our chart to something that already fits
        you. Lay it flat and measure:
      </p>
      <ul>
        <li>
          <strong>Chest:</strong> straight across, from armpit seam to armpit seam.
        </li>
        <li>
          <strong>Length:</strong> from the highest point of the shoulder, next to the collar, down
          to the bottom hem.
        </li>
        <li>
          <strong>Sleeve:</strong> from the shoulder seam to the end of the cuff.
        </li>
      </ul>
      <p>
        Then open the size chart on the product page and choose the size whose numbers are closest
        to yours.
      </p>

      <h2>Between sizes?</h2>
      <p>Go up a size for a looser fit, or down for a closer one.</p>

      <h2>Good to know</h2>
      <p>
        Because every item is made to order, we can&apos;t exchange for a different size. Take a
        minute to measure before you order. See <Link href="/returns">Returns</Link>.
      </p>
    </InfoPage>
  );
}
