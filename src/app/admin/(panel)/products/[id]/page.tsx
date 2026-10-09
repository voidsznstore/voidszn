import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Loading } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import { getDb } from "@/db";
import { getProductDraft, listCategories } from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { isStorageConfigured } from "@/lib/storage";
import { deleteProductAction } from "../actions";

export const metadata: Metadata = { title: "Edit product" };

type Props = PageProps<"/admin/products/[id]">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditProductPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <EditProduct params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditProduct({ params, searchParams }: Props) {
  await requireAdmin();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const [draft, categories] = await Promise.all([
    UUID.test(id) ? getProductDraft(db, id) : null,
    listCategories(db),
  ]);
  if (!draft) notFound();

  return (
    <>
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="display text-4xl text-white">{draft.name}</h1>
      </header>

      {/* The key makes the form start over from what was saved after every save. */}
      <ProductForm
        key={`${JSON.stringify(draft)}:${typeof saved === "string" ? saved : ""}`}
        draft={draft}
        categories={categories.map(({ id: categoryId, kind, name }) => ({ id: categoryId, kind, name }))}
        canUpload={isStorageConfigured()}
        savedNotice={typeof saved === "string"}
      />

      <form action={deleteProductAction} className="mb-28 flex flex-col gap-2 border-t border-line pt-6">
        <input type="hidden" name="id" value={draft.id} />
        <p className="text-sm text-smoke">
          Deleting removes the product and its photos from the store. Past orders keep their
          record of it. To take it off sale without deleting, set it to Draft.
        </p>
        <ConfirmButton label="Delete this product" confirmLabel={`Delete ${draft.name}`} />
      </form>
    </>
  );
}
