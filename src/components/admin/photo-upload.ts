/** The longest side a photo is shrunk to before upload. Plenty for a product page. */
const MAX_SIDE = 2000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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

/**
 * Shrinks a photo and stores it. Returns the public address it can be shown from.
 * Throws with a message that can be shown to the person as it is.
 */
export async function uploadPhoto(file: File): Promise<{ url: string; width: number; height: number }> {
  const photo = await preparePhoto(file);
  const body = new FormData();
  body.set("file", photo.blob, "photo");
  const response = await fetch("/api/admin/uploads", { method: "POST", body });
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !data?.url) throw new Error(data?.error ?? "The photo could not be stored.");
  return { url: data.url, width: photo.width, height: photo.height };
}
