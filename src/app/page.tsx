import Link from "next/link";
import { ProductCard } from "@/components/product/product-card";
import { ProductArt } from "@/components/product/product-art";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getCategories, getCollectionProducts, getProducts } from "@/lib/catalog";
import { primaryImage } from "@/lib/catalog/shape";

const PROMISES = ["Printed to order", "Tracked shipping", "Secure checkout"];

export default async function HomePage() {
  const [products, justInAll, productTypes, interests] = await Promise.all([
    getProducts(),
    getCollectionProducts("just-in"),
    getCategories("PRODUCT_TYPE"),
    getCategories("INTEREST"),
  ]);
  const justIn = justInAll.slice(0, 4);
  // The first product in the store's order leads the page. With nothing on sale
  // yet, the hero stands alone.
  const featured = products[0];
  const featuredColor = featured?.colors[0];

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* Hero. The drawn tee stands in for a lifestyle photo. */}
        <section className="border-b border-line bg-ash">
          <div className="mx-auto grid max-w-site items-center gap-10 px-4 py-14 sm:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
            <div className="flex flex-col gap-6">
              <p className="label text-accent">Just in</p>
              <h1 className="display text-[clamp(3.5rem,10vw,8.5rem)] text-white">
                Nothing is in season
              </h1>
              <p className="max-w-md text-lg text-bone-dim">
                Graphic tees and more, printed when you order.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/collections/all" className="btn btn-accent">
                  Shop all
                </Link>
                <Link href="/collections/best-sellers" className="btn btn-outline">
                  Best sellers
                </Link>
              </div>
            </div>

            {featured && featuredColor ? (
              <Link
                href={`/products/${featured.slug}`}
                aria-label={featured.name}
                className="relative mx-auto block aspect-[4/5] w-full max-w-md overflow-hidden bg-well transition-colors hover:bg-well-hover"
              >
                <ProductArt
                  image={primaryImage(featured)}
                  label={`${featured.name} in ${featuredColor.name}`}
                  color={featuredColor}
                  graphic={featured.graphic}
                  sizes="(min-width: 1024px) 28rem, 90vw"
                  padding="p-10"
                  priority
                />
              </Link>
            ) : null}
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

        {justIn.length > 0 ? (
          <section className="mx-auto max-w-site px-4 pt-20 sm:px-10">
            <div className="mb-7 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="display text-5xl text-white">Just in</h2>
              <Link
                href="/collections/just-in"
                className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:text-white"
              >
                View all
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-4">
              {justIn.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-site px-4 pt-20 sm:px-10">
          <h2 className="display mb-7 text-5xl text-white">Shop by category</h2>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {productTypes.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/collections/${category.slug}`}
                  className="flex min-h-36 flex-col justify-end border border-line bg-ash-soft p-5 transition-colors hover:border-bone"
                >
                  <span className="display text-3xl text-white sm:text-4xl">{category.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {interests.length > 0 ? (
          <section className="mx-auto max-w-site px-4 py-20 sm:px-10">
            <h2 className="display mb-7 text-5xl text-white">Shop by interest</h2>
            <ul className="flex flex-wrap gap-3">
              {interests.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/collections/${category.slug}`}
                    className="inline-flex min-h-12 items-center border border-line-strong px-5 text-sm font-semibold uppercase tracking-[0.06em] transition-colors hover:border-bone hover:bg-bone hover:text-void"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="pb-20" />
        )}
      </main>

      <SiteFooter />
    </>
  );
}
