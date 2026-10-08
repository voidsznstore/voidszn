import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Email, InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about delivery times, sizing, returns and changing an order.",
};

const { shipping, orders, supportEmail } = siteConfig;

const QUESTIONS: { question: string; answer: ReactNode }[] = [
  {
    question: "When will my order arrive?",
    answer: (
      <>
        Every item is printed after you order. Production takes {shipping.productionDays} business
        days, then standard shipping takes {shipping.transitDays} business days. More on the{" "}
        <Link href="/shipping">Shipping</Link> page.
      </>
    ),
  },
  {
    question: "Where do you ship?",
    answer: <>We ship to addresses in {shipping.regions}.</>,
  },
  {
    question: "How do I track my order?",
    answer: (
      <>
        We email a tracking number when your order is handed to the carrier. It can take up to a
        day to start updating.
      </>
    ),
  },
  {
    question: "Can I change or cancel my order?",
    answer: (
      <>
        Yes, within {orders.cancelWindow} of ordering. Email <Email address={supportEmail} /> with
        your order number. After that it is in production and can&apos;t be changed.
      </>
    ),
  },
  {
    question: "Can I return or exchange something?",
    answer: (
      <>
        Because each item is made for the person who ordered it, we can&apos;t take returns for a
        change of mind or a wrong size. If it arrives damaged, defective or wrong, we replace or
        refund it. See <Link href="/returns">Returns</Link>.
      </>
    ),
  },
  {
    question: "My order arrived damaged or wrong. What do I do?",
    answer: (
      <>
        Email <Email address={supportEmail} /> within {orders.issueWindowDays} days of delivery with
        your order number and a photo. We will send a replacement or refund you.
      </>
    ),
  },
  {
    question: "How do the sizes run?",
    answer: (
      <>
        Each product page has its own size chart. The <Link href="/size-guide">Size Guide</Link>{" "}
        shows how to measure a shirt you already own so you can compare.
      </>
    ),
  },
  {
    question: "How do I care for my order?",
    answer: <>Care instructions are listed under Details on each product page.</>,
  },
  {
    question: "How can I pay?",
    answer: <>Major credit and debit cards, plus any wallet options shown at checkout.</>,
  },
];

export default function FaqPage() {
  return (
    <InfoPage title="FAQ" intro="Quick answers to the questions we get most.">
      {QUESTIONS.map(({ question, answer }) => (
        <section key={question}>
          <h3>{question}</h3>
          <p>{answer}</p>
        </section>
      ))}
      <h2>Still stuck?</h2>
      <p>
        <Link href="/contact">Contact us</Link> and we will sort it out.
      </p>
    </InfoPage>
  );
}
