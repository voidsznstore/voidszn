"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import {
  FormError,
  type ProductDraft,
  deleteProduct,
  saveProduct,
  slugify,
} from "@/db/queries/admin-catalog";
import { requireAdmin } from "@/lib/admin/session";
import { CATALOG_TAG } from "@/lib/catalog/tag";
import { deleteObjectByUrl, storagePublicUrl } from "@/lib/storage";

const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(1_000_000);
const uuid = z.string().uuid();

const draftSchema = z.object({
  id: uuid.optional(),
  name: text(120).min(1, "Give the product a name."),
  slug: text(80),
  isActive: z.boolean(),
  priceCents: cents,
  compareAtPriceCents: cents.nullable(),
  costCents: cents.nullable(),
  shortDescription: text(300),
  description: text(5000),
  detailsText: text(5000),
  fitText: text(2000),
  typeId: uuid.nullable(),
  interestIds: z.array(uuid).max(50),
  colors: z
    .array(
      z.object({
        id: uuid.optional(),
        name: text(40).min(1, "Every color needs a name."),
        hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color for every swatch."),
      }),
    )
    .max(30),
  sizes: z
    .array(
      z.object({
        size: text(12).min(1, "Every size needs a label."),
        priceCents: cents.nullable(),
        costCents: cents.nullable(),
      }),
    )
    .max(20),
  images: z
    .array(
      z.object({
        id: uuid.optional(),
        url: z.string().url().max(500),
        alt: text(200),
        width: z.number().int().positive().max(20_000).nullable(),
        height: z.number().int().positive().max(20_000).nullable(),
        color: z.number().int().min(0).nullable(),
      }),
    )
    .max(40),
});

export type SaveProductResult = { error: string } | { id: string };

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function saveProductAction(input: unknown): Promise<SaveProductResult> {
  await requireAdmin();

  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const draft: ProductDraft = {
    ...parsed.data,
    slug: slugify(parsed.data.slug || parsed.data.name),
    colors: parsed.data.colors.map((color) => ({ ...color, hex: color.hex.toLowerCase() })),
  };

  if (!draft.slug) return { error: "Give the product a name with at least one letter or number." };
  const distinct = (values: string[]) => new Set(values.map(normalized)).size === values.length;
  if (!distinct(draft.colors.map((color) => color.name))) {
    return { error: "Two colors have the same name. Give each color its own name." };
  }
  if (!distinct(draft.sizes.map((size) => size.size))) {
    return { error: "The same size is listed twice." };
  }
  if (draft.images.some((image) => image.color !== null && image.color >= draft.colors.length)) {
    return { error: "A photo is assigned to a color that was removed." };
  }
  if (draft.compareAtPriceCents !== null && draft.compareAtPriceCents <= draft.priceCents) {
    return { error: "The compare-at price has to be higher than the price." };
  }

  // Photos can only point at the store's own image storage.
  const publicUrl = storagePublicUrl();
  if (draft.images.some((image) => !publicUrl || !image.url.startsWith(`${publicUrl}/`))) {
    return { error: "A photo didn't upload properly. Remove it and add it again." };
  }

  // A product can be saved half-finished as a draft, but not put on sale.
  if (draft.isActive) {
    if (draft.priceCents <= 0) return { error: "Set a price before putting this on sale." };
    if (!draft.typeId) return { error: "Pick a product type before putting this on sale." };
    if (draft.colors.length === 0) return { error: "Add at least one color before putting this on sale." };
    if (draft.sizes.length === 0) return { error: "Add at least one size before putting this on sale." };
  }

  try {
    const saved = await saveProduct(getDb(), draft);
    updateTag(CATALOG_TAG);
    // The files for removed photos are no longer needed.
    await Promise.all(
      saved.removedImageUrls.map((url) =>
        deleteObjectByUrl(url).catch((error) =>
          console.error("[admin] Could not delete a removed photo", error),
        ),
      ),
    );
    return { id: saved.id };
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    console.error("[admin] Could not save product", error);
    return { error: "Something went wrong saving. Nothing was changed. Try again." };
  }
}

export async function deleteProductAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) redirect("/admin/products");

  const urls = await deleteProduct(getDb(), id.data);
  updateTag(CATALOG_TAG);
  await Promise.all(
    urls.map((url) =>
      deleteObjectByUrl(url).catch((error) =>
        console.error("[admin] Could not delete a photo", error),
      ),
    ),
  );
  redirect("/admin/products?deleted=1");
}
