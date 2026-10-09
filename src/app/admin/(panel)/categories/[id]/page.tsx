import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EditCategoryForm } from "@/components/admin/category-forms";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Loading } from "@/components/admin/page-header";
import { SortableList } from "@/components/admin/sortable-list";
import { getDb } from "@/db";
import { getCategory } from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { deleteCategoryAction, reorderCategoryProductsAction } from "../actions";

export const metadata: Metadata = { title: "Category" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CategoryPage({ params }: PageProps<"/admin/categories/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Category params={params} />
    </Suspense>
  );
}

async function Category({ params }: Pick<PageProps<"/admin/categories/[id]">, "params">) {
  await requireAdmin();
  const { id } = await params;
  const category = UUID.test(id) ? await getCategory(getDb(), id) : null;
  if (!category) notFound();

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <Link href="/admin/categories" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
          All categories
        </Link>
        <h1 className="display text-4xl text-white">{category.name}</h1>
        <p className="text-sm text-smoke">
          {category.kind === "PRODUCT_TYPE" ? "Product type" : "Interest"} · on the store at{" "}
          <Link
            href={`/collections/${category.slug}`}
            prefetch={false}
            className="underline underline-offset-4"
          >
            /collections/{category.slug}
          </Link>
        </p>
      </header>

      <EditCategoryForm category={category} />

      <section className="flex max-w-2xl flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Products in this category</h2>
          <p className="text-sm text-smoke">
            Drag to set the order they appear in on this category&apos;s page.
          </p>
        </div>
        <SortableList
          noun="product"
          save={reorderCategoryProductsAction.bind(null, category.id)}
          items={category.products.map((product) => ({
            id: product.id,
            title: product.name,
            note: product.isActive ? undefined : "Draft",
            href: `/admin/products/${product.id}`,
          }))}
        />
      </section>

      <form action={deleteCategoryAction} className="flex flex-col gap-2 border-t border-line pt-6">
        <input type="hidden" name="id" value={category.id} />
        <p className="text-sm text-smoke">
          Deleting a category doesn&apos;t delete its products. They stay in the store and in
          their other categories.
        </p>
        <ConfirmButton label="Delete this category" confirmLabel={`Delete ${category.name}`} />
      </form>
    </div>
  );
}
