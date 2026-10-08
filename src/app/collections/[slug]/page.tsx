import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionBrowser } from "@/components/product/collection-browser";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getCollection, getCollectionProducts, getCollections } from "@/lib/catalog";

export function generateStaticParams() {
  return getCollections().map((collection) => ({ slug: collection.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const collection = getCollection(slug);
  if (!collection) return {};
  return { title: collection.name, description: collection.description };
}

export default async function CollectionPage({ params }: PageProps<"/collections/[slug]">) {
  const { slug } = await params;
  const collection = getCollection(slug);
  if (!collection) notFound();

  const products = getCollectionProducts(collection.slug);

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
          <span className="text-bone">{collection.name}</span>
        </nav>

        <header className="flex flex-col gap-3 pb-8 pt-4">
          <h1 className="display text-[clamp(3rem,8vw,5.5rem)] text-white">{collection.name}</h1>
          <p className="max-w-xl text-lg text-bone-dim">{collection.description}</p>
        </header>

        <CollectionBrowser products={products} />
      </main>

      <SiteFooter />
    </>
  );
}
