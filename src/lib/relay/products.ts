import "server-only";
import { getDb } from "@/db";
import {
  countProductsToSync,
  failProductSync,
  productForRelay,
  productsToSync,
  saveProductSync,
} from "@/db/queries/relay";
import {
  type WooProduct,
  type WooProductInput,
  type WooVariationInput,
  WooError,
  createProduct,
  findBySkus,
  getProduct,
  isDefiniteRefusal,
  isRelayConfigured,
  listVariations,
  saveVariations,
  updateProduct,
} from "./woo";

/**
 * Copies products to the relay store, so the printer has something to attach
 * each design to. A product goes over as one item with a Color and a Size
 * option, and one variation per option on sale, each under the same SKU it has
 * here. That SKU is how an order line finds its variation later.
 *
 * Nothing is ever deleted over there: the printer's design set-up hangs off
 * those items, and losing one would mean setting it up again.
 */

const money = (cents: number) => (cents / 100).toFixed(2);

/** The SKU the product itself goes under. Variations keep their own. */
export const parentSku = (slug: string) => `P-${slug.toUpperCase()}`;

export type ProductSyncResult = { ok: true } | { ok: false; error: string };

const unique = (values: string[]) => [...new Set(values)];

/** Copies one product, or brings the relay store's copy up to date. */
export async function syncProductToRelay(productId: string): Promise<ProductSyncResult> {
  if (!isRelayConfigured()) return { ok: false, error: "The relay store isn't connected yet." };
  const db = getDb();
  // Taken before reading, so an edit made while the copy runs is newer and is copied next time.
  const startedAt = new Date();
  const product = await productForRelay(db, productId);
  if (!product) return { ok: false, error: "That product no longer exists." };
  if (product.variants.length === 0) {
    const error = "It has no sizes on sale, so there is nothing to copy.";
    await failProductSync(db, productId, error);
    return { ok: false, error };
  }

  try {
    const details: WooProductInput = {
      name: product.name,
      type: "variable",
      status: "publish",
      // Not listed in the relay store's own shop pages. It isn't a second storefront.
      catalog_visibility: "hidden",
      sku: parentSku(product.slug),
      description: product.shortDescription ?? "",
      attributes: [
        { name: "Color", visible: true, variation: true, options: unique(product.variants.map((variant) => variant.color)) },
        { name: "Size", visible: true, variation: true, options: unique(product.variants.map((variant) => variant.size)) },
      ],
    };

    // Find the copy made before: by the id we kept, else by its SKU.
    let existing: WooProduct | null = product.externalProductId ? await getProduct(product.externalProductId) : null;
    if (!existing) {
      existing = (await findBySkus([details.sku])).find((found) => found.sku === details.sku && found.status !== "trash") ?? null;
    }

    let remote: WooProduct;
    if (existing) {
      remote = await updateProduct(existing.id, details);
    } else {
      const images = product.images.filter((url) => url.startsWith("https://")).map((src) => ({ src }));
      try {
        remote = await createProduct(images.length > 0 ? { ...details, images } : details);
      } catch (error) {
        // The shop fetches each photo itself and refuses the whole product if one won't load.
        // The printer doesn't need our photos, so the product goes over without them.
        if (!(error instanceof WooError) || error.code !== "woocommerce_product_image_upload_error") throw error;
        remote = await createProduct(details);
      }
    }

    // A size is matched to the variation it was copied to before, so one whose SKU
    // has since changed (a renamed product or color) is renamed over there too and
    // keeps the printer's set-up. Failing that, by SKU.
    const remoteVariations = await listVariations(remote.id);
    const byId = new Map(remoteVariations.map((variation) => [String(variation.id), variation]));
    const there = new Map(remoteVariations.map((variation) => [variation.sku, variation]));
    const create: WooVariationInput[] = [];
    const update: WooVariationInput[] = [];
    const links: { variantId: string; externalVariantId: string }[] = [];
    for (const variant of product.variants) {
      const wanted: WooVariationInput = {
        sku: variant.sku,
        regular_price: money(variant.priceCents),
        status: "publish",
        attributes: [
          { name: "Color", option: variant.color },
          { name: "Size", option: variant.size },
        ],
      };
      const current = (variant.externalVariantId ? byId.get(variant.externalVariantId) : undefined) ?? there.get(variant.sku);
      if (!current) {
        create.push(wanted);
        continue;
      }
      links.push({ variantId: variant.id, externalVariantId: String(current.id) });
      const option = (name: string) => current.attributes.find((attribute) => attribute.name === name)?.option;
      const same =
        current.sku === wanted.sku &&
        current.regular_price === wanted.regular_price &&
        current.status === "publish" &&
        option("Color") === variant.color &&
        option("Size") === variant.size;
      if (!same) update.push({ ...wanted, id: current.id });
    }

    const { saved, problems } = await saveVariations(remote.id, { create, update });
    for (const made of saved) {
      const variant = product.variants.find((candidate) => candidate.sku === made.sku);
      if (variant && !links.some((link) => link.variantId === variant.id)) {
        links.push({ variantId: variant.id, externalVariantId: String(made.id) });
      }
    }
    if (problems.length > 0) {
      const error = `Some sizes couldn't be copied: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` and ${problems.length - 3} more` : ""}`;
      await failProductSync(db, productId, error);
      return { ok: false, error };
    }

    await saveProductSync(db, productId, String(remote.id), links, startedAt);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof WooError)) throw error;
    const { detail } = error;
    const message = isDefiniteRefusal(error) ? `The relay store refused it: ${detail}` : `${detail} It will be tried again.`;
    await failProductSync(db, productId, message);
    return { ok: false, error: message };
  }
}

export type CatalogSync = { copied: number; failed: number; left: number };

/**
 * Copies every product that is new or has changed, for as long as `budgetMs`
 * allows. What doesn't fit is picked up by the next run.
 */
export async function syncCatalogToRelay(budgetMs: number): Promise<CatalogSync> {
  const result: CatalogSync = { copied: 0, failed: 0, left: 0 };
  if (!isRelayConfigured()) return result;
  const db = getDb();
  const started = Date.now();

  for (const id of await productsToSync(db, 500)) {
    if (Date.now() - started >= budgetMs) break;
    const outcome = await syncProductToRelay(id);
    if (outcome.ok) result.copied += 1;
    else result.failed += 1;
  }
  // Ones that failed are still "to do", so they are counted apart from ones not reached.
  result.left = Math.max(0, (await countProductsToSync(db)) - result.failed);
  return result;
}
