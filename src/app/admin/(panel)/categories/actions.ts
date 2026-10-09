"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import {
  FormError,
  createCategory,
  deleteCategory,
  reorderCategories,
  reorderCategoryProducts,
  updateCategory,
} from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { CATALOG_TAG } from "@/lib/catalog/tag";

export type CategoryFormState = { error?: string; saved?: boolean };

const uuid = z.string().uuid();
const kind = z.enum(["PRODUCT_TYPE", "INTEREST"]);
const name = z.string().trim().min(1, "Give the category a name.").max(60);
const description = z.string().trim().max(300);

export async function createCategoryAction(
  _previous: CategoryFormState,
  form: FormData,
): Promise<CategoryFormState> {
  await requireAdmin();
  const parsed = z
    .object({ kind, name, description })
    .safeParse({
      kind: form.get("kind"),
      name: form.get("name"),
      description: form.get("description") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    await createCategory(getDb(), parsed.data);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  updateTag(CATALOG_TAG);
  return { saved: true };
}

export async function updateCategoryAction(
  _previous: CategoryFormState,
  form: FormData,
): Promise<CategoryFormState> {
  await requireAdmin();
  const parsed = z
    .object({ id: uuid, name, description, isActive: z.boolean() })
    .safeParse({
      id: form.get("id"),
      name: form.get("name"),
      description: form.get("description") ?? "",
      isActive: form.get("isActive") === "on",
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const { id, ...fields } = parsed.data;
  await updateCategory(getDb(), id, fields);
  updateTag(CATALOG_TAG);
  return { saved: true };
}

export async function deleteCategoryAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = uuid.safeParse(form.get("id"));
  if (id.success) {
    await deleteCategory(getDb(), id.data);
    updateTag(CATALOG_TAG);
  }
  redirect("/admin/categories");
}

export async function reorderCategoriesAction(
  categoryKind: string,
  ids: string[],
): Promise<{ ok: boolean }> {
  await requireAdmin();
  const parsed = z.object({ kind, ids: z.array(uuid).max(500) }).safeParse({ kind: categoryKind, ids });
  if (!parsed.success) return { ok: false };
  await reorderCategories(getDb(), parsed.data.kind, parsed.data.ids);
  updateTag(CATALOG_TAG);
  return { ok: true };
}

export async function reorderCategoryProductsAction(
  categoryId: string,
  productIds: string[],
): Promise<{ ok: boolean }> {
  await requireAdmin();
  const parsed = z
    .object({ categoryId: uuid, productIds: z.array(uuid).max(2000) })
    .safeParse({ categoryId, productIds });
  if (!parsed.success) return { ok: false };
  await reorderCategoryProducts(getDb(), parsed.data.categoryId, parsed.data.productIds);
  updateTag(CATALOG_TAG);
  return { ok: true };
}
