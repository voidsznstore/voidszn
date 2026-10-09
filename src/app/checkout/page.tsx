import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-24 pt-10 sm:px-10">
        <h1 className="display mb-8 text-center text-[clamp(2.5rem,6vw,4rem)] text-white">Checkout</h1>
        <CheckoutForm />
      </main>
      <SiteFooter />
    </>
  );
}
