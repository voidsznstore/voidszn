import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import { getDb } from "@/db";
import { type ProductDraft, listCategories } from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { isStorageConfigured } from "@/lib/storage";

export const metadata: Metadata = { title: "Add product" };

const BLANK: ProductDraft = {
  name: "",
  slug: "",
  isActive: false,
  priceCents: 0,
  costCents: null,
  compareAtPriceCents: null,
  shortDescription: "",
  description: "",
  detailsText: "",
  fitText: "",
  typeId: null,
  interestIds: [],
  colors: [],
  sizes: ["S", "M", "L", "XL", "2XL"].map((size) => ({ size, priceCents: null, costCents: null })),
  images: [],
};

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="Add product" />
      <Suspense fallback={<Loading />}>
        <NewProduct />
      </Suspense>
    </>
  );
}

async function NewProduct() {
  await requireAdmin();
  const categories = await listCategories(getDb());
  return (
    <ProductForm
      draft={BLANK}
      categories={categories.map(({ id, kind, name }) => ({ id, kind, name }))}
      canUpload={isStorageConfigured()}
      savedNotice={false}
    />
  );
}
