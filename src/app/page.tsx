import Link from "next/link";
import { ProductCard } from "@/components/product/product-card";
import { TeeMockup } from "@/components/product/tee-mockup";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getProducts } from "@/lib/catalog";

const PROMISES = ["Printed to order", "Tracked shipping", "Secure checkout"];

export default function HomePage() {
  const products = getProducts();
  const featured = products[0];
  const featuredColor = featured.colors[0];

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* Hero. The drawn tee stands in for a lifestyle photo. */}
        <section className="border-b border-line bg-ash">
          <div className="mx-auto grid max-w-site items-center gap-10 px-4 py-14 sm:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
            <div className="flex flex-col gap-6">
              <p className="label text-accent">New arrivals</p>
              <h1 className="display text-[clamp(3.5rem,10vw,8.5rem)] text-white">
                Nothing is in season
              </h1>
              <p className="max-w-md text-lg text-bone-dim">
                Printed when you order. No logos on the clothes.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="#shop" className="btn btn-accent">
                  Shop now
                </Link>
              </div>
            </div>

            <Link
              href={`/products/${featured.slug}`}
              aria-label={featured.name}
              className="mx-auto flex aspect-[4/5] w-full max-w-md items-center justify-center bg-well p-10 transition-colors hover:bg-well-hover"
            >
              <TeeMockup
                color={featuredColor.hex}
                ink={featuredColor.ink}
                graphic={featured.graphic}
                label={`${featured.name} in ${featuredColor.name}`}
                className="h-full w-full"
              />
            </Link>
          </div>
        </section>

        <div className="border-b border-line">
          <ul className="label mx-auto grid max-w-site gap-x-6 gap-y-3 px-4 py-5 text-xs sm:grid-cols-3 sm:px-10">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-2 w-2 bg-accent" />
                {promise}
              </li>
            ))}
          </ul>
        </div>

        <section id="shop" className="mx-auto max-w-site scroll-mt-6 px-4 py-20 sm:px-10">
          <h2 className="display mb-7 text-5xl text-white">New arrivals</h2>
          <div className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.slug} product={product} />
            ))}
          </div>
        </section>

        <section className="bg-bone text-void">
          <div className="mx-auto flex max-w-site flex-col gap-6 px-4 py-24 sm:px-10">
            <h2 className="display text-[clamp(2.75rem,7vw,6.5rem)]">
              No logos. Nothing to prove.
            </h2>
            <p className="max-w-xl text-lg">
              We don&apos;t put our name on the clothes. The design is the point, and it&apos;s
              printed when you order it.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
