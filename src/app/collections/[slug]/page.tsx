import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CollectionBrowser } from "@/components/product/collection-browser";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getCollection, getCollectionProducts, getCollections } from "@/lib/catalog";

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
      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-24 pt-2 sm:px-10">
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

  const products = await getCollectionProducts(collection.slug);

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className="flex min-h-14 flex-wrap items-center justify-center gap-2 text-sm text-smoke"
      >
        <Link href="/" className="inline-flex min-h-11 items-center hover:text-bone">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-bone">
          {collection.name}
        </span>
      </nav>

      <header className="flex flex-col items-center gap-4 pb-10 pt-2 text-center">
        <h1 className="display text-[clamp(3rem,8vw,5.5rem)] text-white [text-shadow:0_0_42px_rgb(237_234_227/0.18)]">
          {collection.name}
        </h1>
        {collection.description ? (
          <p className="max-w-xl text-balance text-lg text-bone-dim">{collection.description}</p>
        ) : null}
      </header>

      <CollectionBrowser products={products} />
    </>
  );
}
