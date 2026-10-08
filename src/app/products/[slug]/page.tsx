import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product/product-card";
import { ProductView } from "@/components/product/product-view";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import {
  getProductBySlug,
  getProductType,
  getProducts,
  getRelatedProducts,
} from "@/lib/catalog";

export function generateStaticParams() {
  return getProducts().map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return {};
  return { title: product.name, description: product.shortDescription };
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const type = getProductType(product);
  const related = getRelatedProducts(product.slug);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-20 sm:px-10">
        <nav
          aria-label="Breadcrumb"
          className="label flex min-h-14 flex-wrap items-center gap-2 text-xs text-smoke"
        >
          <Link href="/" className="inline-flex min-h-11 items-center hover:text-bone">
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={`/collections/${type?.slug ?? "all"}`}
            className="inline-flex min-h-11 items-center hover:text-bone"
          >
            {type?.name ?? "Shop All"}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-bone">{product.name}</span>
        </nav>

        <ProductView product={product} typeName={type?.name ?? "Shop"} />

        {related.length > 0 ? (
          <section className="pt-20">
            <h2 className="display mb-7 text-5xl text-white">You may also like</h2>
            <div className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3">
              {related.map((item) => (
                <ProductCard key={item.slug} product={item} />
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <SiteFooter />
    </>
  );
}
