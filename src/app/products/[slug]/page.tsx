import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductCard } from "@/components/product/product-card";
import { ProductView } from "@/components/product/product-view";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getProductBySlug, getProducts, getRelatedProducts } from "@/lib/catalog";
import { primaryImage } from "@/lib/catalog/shape";

type Props = PageProps<"/products/[slug]">;

/** Used when the store has no products yet. The build needs one address to prepare. */
const PLACEHOLDER = "coming-soon";

export async function generateStaticParams() {
  const products = await getProducts();
  return products.length > 0
    ? products.map((product) => ({ slug: product.slug }))
    : [{ slug: PLACEHOLDER }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Not found", robots: { index: false } };

  const image = primaryImage(product);
  return {
    title: product.name,
    description: product.shortDescription || product.description.slice(0, 160),
    openGraph: image ? { images: [{ url: image.url }] } : undefined,
  };
}

export default function ProductPage({ params }: Props) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-24 pt-6 sm:px-10 sm:pt-8">
        {/* Products added after the last deploy load here on their first visit. */}
        <Suspense fallback={<div className="min-h-[70vh]" aria-busy="true" />}>
          <Product params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Product({ params }: Pick<Props, "params">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const related = await getRelatedProducts(product.slug, 5);
  const shopHref = `/collections/${product.typeSlug ?? "all"}`;

  const crumbs = (
    <nav aria-label="Breadcrumb" className="label flex flex-wrap items-center gap-x-2 text-smoke">
      <Link href="/" className="inline-flex min-h-11 items-center hover:text-bone">
        Home
      </Link>
      <span aria-hidden="true">/</span>
      <Link href={shopHref} className="inline-flex min-h-11 items-center hover:text-bone">
        {product.typeName ?? "Shop All"}
      </Link>
    </nav>
  );

  return (
    <>
      <ProductView product={product} crumbs={crumbs} />

      {related.length > 0 ? (
        <section className="pt-20">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="label text-bone">You may also like</h2>
            <Link href={shopHref} className="label link inline-flex min-h-11 items-center text-smoke">
              Back to shop
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-5">
            {related.map((item, index) => (
              // On a row of five the fifth only fits at full width, and a lone one looks stranded.
              <div key={item.slug} className={index === 4 ? "hidden lg:block" : index === 3 ? "md:hidden lg:block" : ""}>
                <ProductCard product={item} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
