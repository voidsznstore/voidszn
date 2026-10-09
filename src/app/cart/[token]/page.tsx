import type { Metadata } from "next";
import { Suspense } from "react";
import { RestoreCart } from "@/components/cart/restore-cart";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/cart/[token]">;

/** Where the button in a cart reminder email lands: it refills the cart and moves on to checkout. */
export default function RestoreCartPage({ params, searchParams }: Props) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pb-24 pt-16 text-center sm:px-10">
        <Suspense fallback={<p className="text-bone-dim">Getting your cart…</p>}>
          <Restore params={params} searchParams={searchParams} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Restore({ params, searchParams }: Props) {
  const [{ token }, { code }] = await Promise.all([params, searchParams]);
  return <RestoreCart token={token} code={typeof code === "string" ? code : null} />;
}
