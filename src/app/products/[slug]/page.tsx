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
      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-24 pt-2 sm:px-10">
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

  const related = await getRelatedProducts(product.slug);

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className="flex min-h-14 flex-wrap items-center gap-2 text-sm text-smoke"
      >
        <Link href="/" className="inline-flex min-h-11 items-center hover:text-bone">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/collections/${product.typeSlug ?? "all"}`}
          className="inline-flex min-h-11 items-center hover:text-bone"
        >
          {product.typeName ?? "Shop All"}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-bone">
          {product.name}
        </span>
      </nav>

      <ProductView product={product} typeName={product.typeName ?? "Shop"} />

      {related.length > 0 ? (
        <section className="pt-24">
          <h2 className="display mb-8 text-center text-[clamp(2rem,5vw,2.75rem)] text-white">
            You may also like
          </h2>
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-6 lg:grid-cols-3">
            {related.map((item) => (
              <ProductCard key={item.slug} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
