import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CollectionBrowser } from "@/components/product/collection-browser";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getCategories, getCollection, getCollectionProducts, getCollections } from "@/lib/catalog";

type Props = PageProps<"/collections/[slug]">;

export async function generateStaticParams() {
  return (await getCollections()).map((collection) => ({ slug: collection.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollection(slug);
  if (!collection) return { title: "Not found", robots: { index: false } };
  return { title: collection.name, description: collection.description || undefined };
}

export default function CollectionPage({ params }: Props) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-24 pt-4 sm:px-10 sm:pt-6">
        {/* Categories added after the last deploy load here on their first visit. */}
        <Suspense fallback={<div className="min-h-[70vh]" aria-busy="true" />}>
          <CollectionContent params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function CollectionContent({ params }: Pick<Props, "params">) {
  const { slug } = await params;
  const collection = await getCollection(slug);
  if (!collection) notFound();

  const [products, categories] = await Promise.all([
    getCollectionProducts(collection.slug),
    getCategories(),
  ]);
  // A category's page offers the other kind of filter: a product type can be
  // narrowed by interest, an interest by product type. The lists offer both.
  const here = categories.find((category) => category.slug === collection.slug);
  const options = (kind: "PRODUCT_TYPE" | "INTEREST") =>
    here?.kind === kind
      ? []
      : categories.filter((category) => category.kind === kind).map(({ slug, name }) => ({ slug, name }));

  return (
    <>
      <nav aria-label="Breadcrumb" className="label flex min-h-11 flex-wrap items-center gap-2 text-smoke">
        <Link href="/" className="inline-flex min-h-11 items-center hover:text-bone">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-bone">
          {collection.name}
        </span>
      </nav>

      <header className="flex flex-col gap-2 pb-7 pt-1">
        <h1 className="text-[clamp(1.875rem,3.6vw,2.875rem)] font-medium leading-[1.06] tracking-[-0.015em] text-white">
          {collection.name}
        </h1>
        {collection.description ? (
          <p className="max-w-xl text-bone-dim">{collection.description}</p>
        ) : null}
      </header>

      <CollectionBrowser
        products={products}
        filters={{ interests: options("INTEREST"), types: options("PRODUCT_TYPE") }}
        eager
      />
    </>
  );
}
