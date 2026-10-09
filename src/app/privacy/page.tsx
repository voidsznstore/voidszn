import type { Metadata } from "next";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal information we collect, why, who we share it with, and your choices.",
};

export default function PrivacyPage() {
  const { name, legalName, mailingAddress, supportEmail } = siteConfig;

  return (
    <InfoPage
      title="Privacy Policy"
      intro="What we collect, why we collect it, who sees it, and what you can do about it."
      policy
    >
      <p>
        {name} (&quot;we&quot;, &quot;us&quot;){" "}
        {(legalName as string) === name ? "runs this site" : `is operated by ${legalName}`}. This policy covers
        this website and the orders placed on it.
      </p>

      <h2>What we collect</h2>
      <h3>Information you give us</h3>
      <ul>
        <li>
          <strong>Order details:</strong> name, email address, shipping address, phone number if
          you provide one, and what you bought.
        </li>
        <li>
          <strong>Payment details:</strong> your card is handled by our payment processor. We
          receive confirmation of payment and the last four digits and card type. We never see or
          store your full card number.
        </li>
        <li>
          <strong>Messages:</strong> anything you send us by email, and reviews or photos you
          choose to submit.
        </li>
        <li>
          <strong>Checkout details:</strong> the email address and delivery address you enter at
          checkout and what is in your cart at that moment, kept even if you don&apos;t finish
          paying. The delivery address of a checkout that is never paid for is deleted after 60
          days.
        </li>
        <li>
          <strong>Marketing sign-up:</strong> your email address, and your phone number if you
          opt in to texts.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Device and usage data:</strong> IP address, browser and device type, pages
          viewed and the page that sent you here.
        </li>
        <li>
          <strong>Cart contents:</strong> saved in your browser so your cart is still there when
          you come back.
        </li>
        <li>
          <strong>Pop-up choices:</strong> whether you closed an offer or signed up through one,
          saved in your browser so it isn&apos;t shown to you again too soon. This stays on your
          device and is not sent to us.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To take payment, make your order and deliver it.</li>
        <li>To send order confirmations, shipping updates and replies to your questions.</li>
        <li>
          To remind you about a cart you started to pay for and left. These reminders stop when
          you order, after a few days, or as soon as you unsubscribe from one.
        </li>
        <li>To send marketing emails or texts, only if you signed up for them.</li>
        <li>To prevent fraud and keep the site secure.</li>
        <li>To understand what is working on the site and improve it.</li>
        <li>To meet legal and tax obligations.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        We share only what each of these needs to do its job, and they may use it only for that
        job:
      </p>
      <ul>
        <li>our payment processor, to take payment and screen for fraud;</li>
        <li>
          our printing partner, which receives your name, address, phone number if you gave one,
          and order to make and ship it;
        </li>
        <li>shipping carriers, to deliver it;</li>
        <li>our email and text service, website host and analytics providers;</li>
        <li>authorities, when the law requires it.</li>
      </ul>
      <p>
        <strong>We do not sell your personal information.</strong> If you came to us through a
        partner link or code, that partner sees that a sale happened, not your personal details.
      </p>

      <h2>Cookies and similar technology</h2>
      <p>
        We use browser storage that the site needs to work, such as remembering your cart. If we
        add analytics or advertising tools that track across sites, we will update this policy
        and ask for your consent first where the law requires it.
      </p>

      <h2>Marketing messages</h2>
      <p>
        Every marketing email and every cart reminder has an unsubscribe link, and using it
        stops both. Reply STOP to any marketing text to stop them. Order and shipping messages
        are not marketing and are sent regardless.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can ask us for a copy of the personal information we hold about you, ask us to correct
        it, or ask us to delete it. Email <Email address={supportEmail} /> from the address on
        your order. We may need to confirm your identity, and we keep what the law requires us to
        keep, such as tax records. We answer within 45 days and will never treat you differently
        for asking.
      </p>
      <p>
        Depending on where you live, state law may give you additional rights, including the right
        to appeal a decision we make about your request. Use the same email address to appeal.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep order records for as long as tax and accounting rules require. We keep marketing
        details until you unsubscribe, and messages for as long as needed to resolve them. A
        cart you left at checkout stops being used for reminders after a week.
      </p>

      <h2>Security</h2>
      <p>
        The site is served over an encrypted connection and payment details are handled by a
        certified payment processor. No system is perfectly secure. If a breach affects your
        information, we will notify you as the law requires.
      </p>

      <h2>Children</h2>
      <p>
        This site is not directed to children under 13 and we do not knowingly collect their
        information. If you believe a child has given us information, email us and we will delete
        it.
      </p>

      <h2>Changes</h2>
      <p>
        When we change this policy we update the date at the top. If a change is significant, we
        will also say so on the site.
      </p>

      <h2>Contact</h2>
      <p>
        {legalName}
        <br />
        <span className="fine-print">{mailingAddress}</span>
        <br />
        <Email address={supportEmail} />
      </p>
    </InfoPage>
  );
}
