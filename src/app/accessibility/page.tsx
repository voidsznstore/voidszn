import type { Metadata } from "next";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Our commitment to making this store usable for everyone, and how to reach us.",
};

export default function AccessibilityPage() {
  const { name, supportEmail } = siteConfig;

  return (
    <InfoPage
      title="Accessibility"
      intro="We want everyone to be able to browse and buy here, whatever device or assistive technology they use."
      policy
    >
      <h2>What we aim for</h2>
      <p>
        {name} is built with the Web Content Accessibility Guidelines (WCAG) 2.1, level AA, as its
        target. In practice that means:
      </p>
      <ul>
        <li>every page can be used with a keyboard alone;</li>
        <li>text and controls have enough contrast to read;</li>
        <li>images and buttons have text descriptions for screen readers;</li>
        <li>buttons and links are large enough to tap;</li>
        <li>pages work when zoomed in and on small screens.</li>
      </ul>

      <h2>Tell us what isn&apos;t working</h2>
      <p>
        We test as we build, but we may miss things. If you hit a barrier, or need help placing an
        order, email <Email address={supportEmail} /> and tell us the page and what happened. We
        will help you complete what you were trying to do and fix the problem.
      </p>
    </InfoPage>
  );
}
