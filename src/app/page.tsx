import { CollectionBrowser } from "@/components/product/collection-browser";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getCategories, getProducts } from "@/lib/catalog";

/** The front page goes straight to the clothes: every product, with filters across the top. */
export default async function HomePage() {
  const [products, types, interests] = await Promise.all([
    getProducts(),
    getCategories("PRODUCT_TYPE"),
    getCategories("INTEREST"),
  ]);
  const options = (list: { slug: string; name: string }[]) =>
    list.map(({ slug, name }) => ({ slug, name }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-site flex-1 px-4 pb-24 pt-6 sm:px-10 sm:pt-8">
        <h1 className="sr-only">VOIDSZN: graphic tees and more, printed when you order</h1>
        <CollectionBrowser
          products={products}
          filters={{ interests: options(interests), types: options(types) }}
          eager
        />
      </main>
      <SiteFooter />
    </>
  );
}
