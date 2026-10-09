import type { Metadata } from "next";
import { Suspense } from "react";
import { NewCategoryForm } from "@/components/admin/category-forms";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { SortableList } from "@/components/admin/sortable-list";
import { getDb } from "@/db";
import { type AdminCategory, listCategories } from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { reorderCategoriesAction } from "./actions";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categories" />
      <Suspense fallback={<Loading />}>
        <Categories />
      </Suspense>
    </>
  );
}

const GROUPS = [
  {
    kind: "PRODUCT_TYPE",
    title: "Product types",
    help: "What the item is. Every product has exactly one.",
    add: "New product type, e.g. Tank Tops",
  },
  {
    kind: "INTEREST",
    title: "Interests",
    help: "What the design is about. A product can be in several.",
    add: "New interest, e.g. Sports",
  },
] as const;

const note = (category: AdminCategory) =>
  [
    `${category.productCount} ${category.productCount === 1 ? "product" : "products"}`,
    category.isActive ? null : "Hidden",
  ]
    .filter(Boolean)
    .join(" · ");

async function Categories() {
  await requireAdmin();
  const categories = await listCategories(getDb());

  return (
    <div className="grid gap-12 xl:grid-cols-2">
      {GROUPS.map((group) => (
        <section key={group.kind} className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{group.title}</h2>
            <p className="text-sm text-smoke">
              {group.help} Drag to set the order they appear in on the store.
            </p>
          </div>
          <SortableList
            noun="category"
            save={reorderCategoriesAction.bind(null, group.kind)}
            items={categories
              .filter((category) => category.kind === group.kind)
              .map((category) => ({
                id: category.id,
                title: category.name,
                note: note(category),
                href: `/admin/categories/${category.id}`,
              }))}
          />
          <NewCategoryForm kind={group.kind} label={group.add} />
        </section>
      ))}
    </div>
  );
}
