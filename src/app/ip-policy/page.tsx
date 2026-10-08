import type { Metadata } from "next";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "IP and Publicity Rights",
  description: "How to report a design you believe infringes your rights, and how we respond.",
};

export default function IpPolicyPage() {
  const { name, legalName, mailingAddress, legalEmail } = siteConfig;

  return (
    <InfoPage
      title="IP and Publicity Rights"
      intro="We respect the rights of artists, brands and individuals. If something on this site uses your work, name or likeness without permission, tell us and we will act on it."
      policy
    >
      <h2>Our position</h2>
      <p>
        {name} does not knowingly sell designs that infringe someone else&apos;s copyright or
        trademark, or that use a real person&apos;s name or likeness without permission. When we
        receive a valid notice, we remove the design promptly.
      </p>

      <h2>How to report a design</h2>
      <p>
        Email <Email address={legalEmail} /> with all of the following:
      </p>
      <ol>
        <li>Your name, company if any, and contact details.</li>
        <li>
          The work or right you believe is infringed, for example the copyrighted artwork, the
          trademark and its registration number, or the person whose likeness is used.
        </li>
        <li>A link to each product page you are reporting.</li>
        <li>
          A statement that you believe in good faith the use is not authorized by the rights owner,
          its agent or the law.
        </li>
        <li>
          A statement, under penalty of perjury, that the information in your notice is accurate
          and that you are the rights owner or authorized to act for them.
        </li>
        <li>Your physical or electronic signature.</li>
      </ol>

      <h2>What happens next</h2>
      <p>
        We review every complete notice and remove or disable the reported design while we look
        into it. We may share your notice with the person who created the design.
      </p>

      <h2>If your design was removed by mistake</h2>
      <p>
        If you created a design we removed and believe the notice was wrong, reply to our removal
        email explaining why, with your contact details and a statement under penalty of perjury
        that you believe it was removed by mistake or misidentification.
      </p>

      <h2>Repeat problems</h2>
      <p>
        We stop working with designers and partners who are repeatedly the subject of valid
        notices.
      </p>

      <h2>Where to send notices</h2>
      <p>
        {legalName}
        <br />
        {mailingAddress}
        <br />
        <Email address={legalEmail} />
      </p>
    </InfoPage>
  );
}
