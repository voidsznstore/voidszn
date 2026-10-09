import Link from "next/link";
import { ProductCard } from "@/components/product/product-card";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getCategories, getCollectionProducts } from "@/lib/catalog";

export default async function HomePage() {
  const [justInAll, productTypes, interests] = await Promise.all([
    getCollectionProducts("just-in"),
    getCategories("PRODUCT_TYPE"),
    getCategories("INTEREST"),
  ]);
  const justIn = justInAll.slice(0, 4);

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* The logo, at the size of a poster: the line crossing the eclipse. */}
        <section className="relative overflow-hidden">
          <div className="mx-auto flex max-w-site flex-col items-center px-4 pb-14 pt-6 text-center sm:px-10 sm:pb-16 sm:pt-8">
            {/* As tall as the disc, so the line sits across its middle and the rest clears it. */}
            <div
              className="relative flex w-full items-center justify-center"
              style={{ height: "var(--disc)", ["--disc" as string]: "clamp(15rem, 34vw, 24rem)" }}
            >
              <span
                aria-hidden="true"
                className="eclipse left-1/2 top-0 -translate-x-1/2"
                style={{ fontSize: "var(--disc)" }}
              />
              <h1 className="display relative text-[clamp(3.75rem,12vw,9rem)] text-white [text-shadow:0_0_42px_rgb(237_234_227/0.22)]">
                Nothing is
                <br />
                in season
              </h1>
            </div>

            <p className="mt-7 max-w-md text-balance text-lg text-bone-dim">
              Graphic tees and more, printed when you order.
            </p>
            <div className="mt-7 flex w-full flex-wrap items-center justify-center gap-3">
              <Link href="/collections/all" className="btn btn-accent min-w-40">
                Shop all
              </Link>
              <Link href="/collections/best-sellers" className="btn btn-glass min-w-40">
                Best sellers
              </Link>
            </div>
          </div>
        </section>

        {justIn.length > 0 ? (
          <section className="mx-auto max-w-site px-4 sm:px-10">
            <SectionTitle>Just in</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-6 lg:grid-cols-4">
              {justIn.map((product, index) => (
                <ProductCard key={product.slug} product={product} priority={index < 2} />
              ))}
            </div>
            <div className="mt-10 flex justify-center">
              <Link href="/collections/just-in" className="btn btn-glass">
                View all new arrivals
              </Link>
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-site px-4 pt-24 sm:px-10">
          <SectionTitle>Shop by category</SectionTitle>
          <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {productTypes.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/collections/${category.slug}`}
                  className="panel display flex h-20 items-center justify-center px-3 text-center text-[1.375rem] text-white transition-colors hover:border-bone/60 hover:bg-white/[0.08]"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {interests.length > 0 ? (
          <section className="mx-auto max-w-site px-4 pb-28 pt-20 sm:px-10">
            <SectionTitle>Shop by interest</SectionTitle>
            <ul className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2.5">
              {interests.map((category) => (
                <li key={category.slug}>
                  <Link href={`/collections/${category.slug}`} className="chip">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="pb-28" />
        )}
      </main>

      <SiteFooter />
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="display mb-8 text-center text-[clamp(2rem,5vw,2.75rem)] text-white">
      {children}
    </h2>
  );
}
