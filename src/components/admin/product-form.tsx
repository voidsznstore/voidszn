"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { saveProductAction } from "@/app/admin/(panel)/products/actions";
import type { ProductDraft } from "@/db/queries/admin-catalog";

type CategoryOption = { id: string; kind: "PRODUCT_TYPE" | "INTEREST"; name: string };

type FormColor = { key: string; id?: string; name: string; hex: string };
type FormSize = { key: string; size: string; price: string };
type FormImage = ProductDraft["images"][number] & { key: string };

const COLOR_PRESETS = [
  { name: "Black", hex: "#111111" },
  { name: "White", hex: "#ffffff" },
  { name: "Bone", hex: "#edeae3" },
  { name: "Heather Grey", hex: "#9a9a9a" },
  { name: "Navy", hex: "#1f2a44" },
  { name: "Olive", hex: "#5e6b3f" },
];
const SIZE_PRESET = ["S", "M", "L", "XL", "2XL"];

/** The longest side a photo is shrunk to before upload. Plenty for a product page. */
const MAX_SIDE = 2000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

let counter = 0;
const newKey = () => `k${++counter}`;

const toDollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/** "32", "32.5" and "$32.50" all mean 3250 cents. Returns null for anything else. */
function toCents(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Shrinks and re-encodes a photo in the browser so uploads are quick and pages load fast. */
async function preparePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't prepare photos.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

  for (const [type, quality] of [
    ["image/webp", 0.86],
    ["image/jpeg", 0.86],
    ["image/jpeg", 0.7],
  ] as const) {
    const blob = await encode(type, quality);
    // Some browsers quietly hand back a PNG when they can't make the type asked for.
    if (blob && blob.type === type && blob.size <= MAX_UPLOAD_BYTES) return { blob, width, height };
  }
  throw new Error("That photo is too large to prepare.");
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Fixed text shown before the box, e.g. the start of a web address. */
  prefix?: string;
  /** Set to show a taller box that takes several lines. */
  rows?: number;
  mono?: boolean;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  inputMode?: "decimal";
};

/** A labelled text box. The hint is tied to the box for screen readers. */
function TextField({ label, value, onChange, hint, prefix, rows, mono, ...rest }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const shared = {
    id,
    value,
    "aria-describedby": hintId,
    className: `input ${mono ? "font-mono" : ""}`,
    ...rest,
  };
  const box = rows ? (
    <textarea {...shared} rows={rows} onChange={(event) => onChange(event.target.value)} />
  ) : (
    <input {...shared} onChange={(event) => onChange(event.target.value)} />
  );

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {prefix ? (
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-smoke">{prefix}</span>
          {box}
        </span>
      ) : (
        box
      )}
      {hint ? (
        <p id={hintId} className="text-[0.8125rem] text-smoke">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type ProductFormProps = {
  draft: ProductDraft;
  categories: CategoryOption[];
  /** False when photo storage isn't configured, which turns the upload button off. */
  canUpload: boolean;
  savedNotice: boolean;
};

/**
 * The product editor. The page keeps a visited screen's state around when you
 * leave it, which would bring back the last product's values the next time
 * "Add product" is opened. Keying on the visit makes every fresh visit start clean,
 * while the browser's back button still returns to what was being typed.
 */
export function ProductForm(props: ProductFormProps) {
  const { bfcacheId } = useRouter();
  return <ProductEditor key={bfcacheId} {...props} />;
}

function ProductEditor({ draft, categories, canUpload, savedNotice }: ProductFormProps) {
  const router = useRouter();
  const formId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [name, setName] = useState(draft.name);
  const [slug, setSlug] = useState(draft.slug);
  const [isActive, setIsActive] = useState(draft.isActive);
  const [price, setPrice] = useState(draft.id ? toDollars(draft.priceCents) : "");
  const [compareAt, setCompareAt] = useState(toDollars(draft.compareAtPriceCents));
  const [shortDescription, setShortDescription] = useState(draft.shortDescription);
  const [description, setDescription] = useState(draft.description);
  const [detailsText, setDetailsText] = useState(draft.detailsText);
  const [fitText, setFitText] = useState(draft.fitText);
  const [typeId, setTypeId] = useState(draft.typeId);
  const [interestIds, setInterestIds] = useState(draft.interestIds);
  const [colors, setColors] = useState<FormColor[]>(() =>
    draft.colors.map((color) => ({ ...color, key: newKey() })),
  );
  const [sizes, setSizes] = useState<FormSize[]>(() =>
    draft.sizes.map((size) => ({ key: newKey(), size: size.size, price: toDollars(size.priceCents) })),
  );
  const [images, setImages] = useState<FormImage[]>(() =>
    draft.images.map((image) => ({ ...image, key: newKey() })),
  );
  const [upload, setUpload] = useState<{ done: number; total: number; error?: string } | null>(null);

  const touch = () => {
    setDirty(true);
    setError(null);
  };
  /** Wraps a field's setter so typing in it also marks the form as changed. */
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    touch();
  };

  /* ---- colors ---- */

  /** Applies a new color order or set, keeping each photo pointed at the right color. */
  function replaceColors(next: FormColor[]) {
    const position = new Map(next.map((color, index) => [color.key, index]));
    setImages((current) =>
      current.map((image) => {
        if (image.color === null) return image;
        const key = colors[image.color]?.key;
        return { ...image, color: key ? (position.get(key) ?? null) : null };
      }),
    );
    setColors(next);
    touch();
  }

  function moveColor(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= colors.length) return;
    const next = [...colors];
    [next[index], next[target]] = [next[target], next[index]];
    replaceColors(next);
  }

  /* ---- photos ---- */

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = [...files];
    setUpload({ done: 0, total: list.length });
    let failed: string | undefined;

    for (const [index, file] of list.entries()) {
      try {
        const photo = await preparePhoto(file);
        const body = new FormData();
        body.set("file", photo.blob, "photo");
        const response = await fetch("/api/admin/uploads", { method: "POST", body });
        const data = (await response.json().catch(() => null)) as {
          url?: string;
          error?: string;
        } | null;
        if (!response.ok || !data?.url) throw new Error(data?.error ?? "The photo could not be stored.");
        const url = data.url;
        setImages((current) => [
          ...current,
          { key: newKey(), url, alt: "", width: photo.width, height: photo.height, color: null },
        ]);
        touch();
      } catch (problem) {
        failed = `${file.name}: ${problem instanceof Error ? problem.message : "could not be added."}`;
      }
      setUpload({ done: index + 1, total: list.length, error: failed });
    }

    if (fileInput.current) fileInput.current.value = "";
    if (!failed) setUpload(null);
  }

  function moveImage(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    setImages(next);
    touch();
  }

  /* ---- save ---- */

  function handleSave() {
    const priceCents = price.trim() === "" ? 0 : toCents(price);
    if (priceCents === null) return setError("Enter the price as a number, like 32 or 32.50.");
    const compareAtCents = compareAt.trim() === "" ? null : toCents(compareAt);
    if (compareAt.trim() !== "" && compareAtCents === null) {
      return setError("Enter the compare-at price as a number, or leave it empty.");
    }
    const sizeRows: ProductDraft["sizes"] = [];
    for (const size of sizes) {
      const cents = size.price.trim() === "" ? null : toCents(size.price);
      if (size.price.trim() !== "" && cents === null) {
        return setError(`Enter the price for size ${size.size || "?"} as a number, or leave it empty.`);
      }
      sizeRows.push({ size: size.size, priceCents: cents });
    }

    const payload: ProductDraft = {
      id: draft.id,
      name,
      slug,
      isActive,
      priceCents,
      compareAtPriceCents: compareAtCents,
      shortDescription,
      description,
      detailsText,
      fitText,
      typeId,
      interestIds,
      colors: colors.map(({ id, name: colorName, hex }) => ({ id, name: colorName, hex })),
      sizes: sizeRows,
      images: images.map(({ id, url, alt, width, height, color }) => ({
        id,
        url,
        alt,
        width,
        height,
        color,
      })),
    };

    setError(null);
    startTransition(async () => {
      const result = await saveProductAction(payload).catch(() => ({
        error: "Something went wrong saving. Check your connection and try again.",
      }));
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setDirty(false);
      // Reload with what was saved, so new colors and photos get their saved ids.
      router.replace(`/admin/products/${result.id}?saved=${Date.now()}`);
    });
  }

  const types = categories.filter((category) => category.kind === "PRODUCT_TYPE");
  const interests = categories.filter((category) => category.kind === "INTEREST");
  const uploading = upload !== null && upload.done < upload.total;
  const fieldset = "flex flex-col gap-4 border border-line bg-ash-soft p-5";
  const legend = "text-lg font-semibold text-white";
  const small = "text-[0.8125rem] text-smoke";
  const iconButton =
    "h-11 w-11 flex-none border border-line-strong disabled:border-line disabled:text-line-strong";

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
      className="flex flex-col gap-6 pb-10"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Basics */}
          <section className={fieldset}>
            <h2 className={legend}>Basics</h2>
            <TextField label="Name" value={name} onChange={edit(setName)} required maxLength={120} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Price (USD)"
                value={price}
                onChange={edit(setPrice)}
                inputMode="decimal"
                placeholder="32.00"
                mono
              />
              <TextField
                label="Compare-at price (optional)"
                value={compareAt}
                onChange={edit(setCompareAt)}
                inputMode="decimal"
                placeholder="Leave empty if not on sale"
                mono
              />
            </div>
            <TextField
              label="Web address"
              value={slug}
              onChange={edit(setSlug)}
              maxLength={80}
              placeholder="made from the name if left empty"
              prefix="/products/"
              mono
              hint={
                draft.id && draft.isActive
                  ? "Changing this breaks links people have already shared."
                  : undefined
              }
            />
          </section>

          {/* Description */}
          <section className={fieldset}>
            <h2 className={legend}>Description</h2>
            <TextField
              label="Description"
              value={description}
              onChange={edit(setDescription)}
              rows={4}
              maxLength={5000}
              hint="Shown under the price. Two or three sentences is plenty."
            />
            <TextField
              label="Short description"
              value={shortDescription}
              onChange={edit(setShortDescription)}
              maxLength={300}
              hint="One line, used by search engines and link previews."
            />
            <TextField
              label="Details"
              value={detailsText}
              onChange={edit(setDetailsText)}
              rows={4}
              maxLength={5000}
              placeholder={"100% cotton, 6 oz\nDirect to garment print\nMachine wash cold"}
              hint="One per line. Each line becomes a bullet point."
            />
            <TextField
              label="Size and fit"
              value={fitText}
              onChange={edit(setFitText)}
              rows={2}
              maxLength={2000}
            />
          </section>

          {/* Colors */}
          <section className={fieldset}>
            <h2 className={legend}>Colors</h2>
            {colors.length === 0 ? <p className={small}>No colors yet.</p> : null}
            <ul className="flex flex-col gap-3">
              {colors.map((color, index) => (
                <li key={color.key} className="flex flex-wrap items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Swatch for ${color.name || "new color"}`}
                    value={color.hex}
                    onChange={(event) => {
                      setColors(colors.map((item) => (item.key === color.key ? { ...item, hex: event.target.value } : item)));
                      touch();
                    }}
                    className="h-11 w-14 flex-none cursor-pointer border border-line-strong bg-transparent p-1"
                  />
                  <input
                    aria-label="Color name"
                    value={color.name}
                    onChange={(event) => {
                      setColors(colors.map((item) => (item.key === color.key ? { ...item, name: event.target.value } : item)));
                      touch();
                    }}
                    maxLength={40}
                    placeholder="Color name"
                    className="input min-w-32 flex-1"
                  />
                  <button type="button" aria-label={`Move ${color.name || "color"} up`} disabled={index === 0} onClick={() => moveColor(index, -1)} className={iconButton}>
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${color.name || "color"} down`} disabled={index === colors.length - 1} onClick={() => moveColor(index, 1)} className={iconButton}>
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${color.name || "color"}`}
                    onClick={() => replaceColors(colors.filter((item) => item.key !== color.key))}
                    className={iconButton}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.filter(
                (preset) => !colors.some((color) => color.name.toLowerCase() === preset.name.toLowerCase()),
              ).map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => replaceColors([...colors, { key: newKey(), ...preset }])}
                  className="inline-flex min-h-11 items-center gap-2 border border-line-strong px-3 text-sm hover:border-bone"
                >
                  <span aria-hidden="true" className="h-4 w-4 rounded-full border border-line-strong" style={{ background: preset.hex }} />
                  Add {preset.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => replaceColors([...colors, { key: newKey(), name: "", hex: "#808080" }])}
                className="inline-flex min-h-11 items-center border border-line-strong px-3 text-sm hover:border-bone"
              >
                Add another color
              </button>
            </div>
            <p className={small}>The first color is the one shown on product cards.</p>
          </section>

          {/* Sizes */}
          <section className={fieldset}>
            <h2 className={legend}>Sizes</h2>
            {sizes.length === 0 ? <p className={small}>No sizes yet.</p> : null}
            <ul className="flex flex-col gap-3">
              {sizes.map((size) => (
                <li key={size.key} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Size"
                    value={size.size}
                    onChange={(event) => {
                      setSizes(sizes.map((item) => (item.key === size.key ? { ...item, size: event.target.value } : item)));
                      touch();
                    }}
                    maxLength={12}
                    placeholder="Size"
                    className="input w-24 font-mono"
                  />
                  <input
                    aria-label={`Price for size ${size.size || "new size"}`}
                    value={size.price}
                    onChange={(event) => {
                      setSizes(sizes.map((item) => (item.key === size.key ? { ...item, price: event.target.value } : item)));
                      touch();
                    }}
                    inputMode="decimal"
                    placeholder="Same as product price"
                    className="input min-w-40 flex-1 font-mono"
                  />
                  <button
                    type="button"
                    aria-label={`Remove size ${size.size || ""}`}
                    onClick={() => {
                      setSizes(sizes.filter((item) => item.key !== size.key));
                      touch();
                    }}
                    className={iconButton}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {sizes.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSizes(SIZE_PRESET.map((size) => ({ key: newKey(), size, price: "" })));
                    touch();
                  }}
                  className="inline-flex min-h-11 items-center border border-line-strong px-3 text-sm hover:border-bone"
                >
                  Add S to 2XL
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setSizes([...sizes, { key: newKey(), size: "", price: "" }]);
                  touch();
                }}
                className="inline-flex min-h-11 items-center border border-line-strong px-3 text-sm hover:border-bone"
              >
                Add a size
              </button>
            </div>
            <p className={small}>
              Leave a price empty to charge the product price. Fill it in for sizes that cost
              more, like 2XL.
            </p>
          </section>

          {/* Photos */}
          <section className={fieldset}>
            <h2 className={legend}>Photos</h2>
            {images.length === 0 ? (
              <p className={small}>
                No photos yet. Until there are, the store shows a plain drawing of a tee in the
                product&apos;s color.
              </p>
            ) : null}
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {images.map((image, index) => (
                <li key={image.key} className="flex flex-col gap-2">
                  <span className="relative block aspect-[4/5] overflow-hidden bg-well">
                    <Image src={image.url} alt="" fill sizes="16rem" unoptimized className="object-cover" />
                    {index === 0 ? (
                      <span className="label absolute left-2 top-2 bg-bone px-2 py-1 text-[0.6875rem] text-void">
                        Main
                      </span>
                    ) : null}
                  </span>
                  <select
                    aria-label={`Photo ${index + 1} is shown for`}
                    value={image.color === null ? "" : String(image.color)}
                    onChange={(event) => {
                      const value = event.target.value === "" ? null : Number(event.target.value);
                      setImages(images.map((item) => (item.key === image.key ? { ...item, color: value } : item)));
                      touch();
                    }}
                    className="input text-sm"
                  >
                    <option value="">All colors</option>
                    {colors.map((color, colorIndex) => (
                      <option key={color.key} value={colorIndex}>
                        {color.name || `Color ${colorIndex + 1}`} only
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Description of photo ${index + 1}`}
                    value={image.alt}
                    onChange={(event) => {
                      setImages(images.map((item) => (item.key === image.key ? { ...item, alt: event.target.value } : item)));
                      touch();
                    }}
                    maxLength={200}
                    placeholder="What the photo shows"
                    className="input text-sm"
                  />
                  <span className="flex gap-2">
                    <button type="button" aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0} onClick={() => moveImage(index, -1)} className={iconButton}>
                      ←
                    </button>
                    <button type="button" aria-label={`Move photo ${index + 1} later`} disabled={index === images.length - 1} onClick={() => moveImage(index, 1)} className={iconButton}>
                      →
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => {
                        setImages(images.filter((item) => item.key !== image.key));
                        touch();
                      }}
                      className={iconButton}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-4">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(event) => handleFiles(event.target.files)}
              />
              <button
                type="button"
                disabled={!canUpload || uploading}
                onClick={() => fileInput.current?.click()}
                className="btn btn-outline min-h-11 px-5 disabled:opacity-50"
              >
                {uploading ? `Uploading ${upload.done + 1} of ${upload.total}…` : "Add photos"}
              </button>
              <p aria-live="polite" className="text-sm text-accent">
                {upload?.error}
              </p>
            </div>
            <p className={small}>
              {canUpload
                ? "JPEG, PNG or WebP. The first photo is the main one. Set a photo to one color and it shows when that color is picked."
                : "Photo storage isn't set up, so photos can't be added yet."}
            </p>
          </section>
        </div>

        {/* Side column */}
        <div className="flex flex-col gap-6">
          <section className={fieldset}>
            <h2 className={legend}>Status</h2>
            {[
              { value: false, label: "Draft", help: "Saved, but not shown on the store." },
              { value: true, label: "On sale", help: "Shown on the store and can be bought." },
            ].map((option) => (
              <label key={option.label} className="flex min-h-11 cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name={`${formId}-status`}
                  checked={isActive === option.value}
                  onChange={() => {
                    setIsActive(option.value);
                    touch();
                  }}
                  className="mt-1 h-5 w-5 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="block font-semibold">{option.label}</span>
                  <span className={small}>{option.help}</span>
                </span>
              </label>
            ))}
            {draft.id && draft.isActive ? (
              <Link href={`/products/${draft.slug}`} className="text-sm underline underline-offset-4">
                View on the store
              </Link>
            ) : null}
          </section>

          <section className={fieldset}>
            <h2 className={legend}>Product type</h2>
            <p className={small}>What the item is. Pick one.</p>
            {types.map((category) => (
              <label key={category.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={`${formId}-type`}
                  checked={typeId === category.id}
                  onChange={() => {
                    setTypeId(category.id);
                    touch();
                  }}
                  className="h-5 w-5 accent-[var(--color-accent)]"
                />
                {category.name}
              </label>
            ))}
          </section>

          <section className={fieldset}>
            <h2 className={legend}>Interests</h2>
            <p className={small}>What the design is about. Pick any that fit.</p>
            {interests.map((category) => (
              <label key={category.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={interestIds.includes(category.id)}
                  onChange={(event) => {
                    setInterestIds(
                      event.target.checked
                        ? [...interestIds, category.id]
                        : interestIds.filter((id) => id !== category.id),
                    );
                    touch();
                  }}
                  className="h-5 w-5 accent-[var(--color-accent)]"
                />
                {category.name}
              </label>
            ))}
          </section>
        </div>
      </div>

      {/* Save bar, always in reach */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-void/95 px-4 py-3 backdrop-blur md:left-56 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="submit" disabled={pending || uploading} className="btn btn-accent disabled:opacity-60">
            {pending ? "Saving…" : draft.id ? "Save changes" : "Save product"}
          </button>
          <Link href="/admin/products" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            Back to products
          </Link>
          <p role="alert" aria-live="assertive" className={`min-w-0 flex-1 text-sm ${error ? "text-accent" : "text-smoke"}`}>
            {error ?? (dirty ? "Unsaved changes." : savedNotice ? "Saved." : "")}
          </p>
        </div>
      </div>
    </form>
  );
}
