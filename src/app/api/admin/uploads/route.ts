import { randomUUID } from "node:crypto";
import { getAdmin } from "@/lib/admin/session";
import { isStorageConfigured, putObject } from "@/lib/storage";

/** The browser shrinks photos before sending, so anything near this is unusual. */
const MAX_BYTES = 4 * 1024 * 1024;

/** Works out what kind of image a file really is from its first bytes, not its name. */
function sniff(bytes: Uint8Array): { type: string; extension: string } | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

  if (starts(0xff, 0xd8, 0xff)) return { type: "image/jpeg", extension: "jpg" };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { type: "image/png", extension: "png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image/webp", extension: "webp" };
  return null;
}

/**
 * Takes one product photo from a signed-in admin and stores it. Answers with the
 * address the photo is served from.
 */
export async function POST(request: Request) {
  // Fully signed in: a session, and the authenticator app set up.
  const admin = await getAdmin();
  if (!admin?.twoStep) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (!isStorageConfigured()) {
    return Response.json({ error: "Photo storage isn't set up." }, { status: 503 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 10_000) {
    return Response.json({ error: "That photo is too large." }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return Response.json({ error: "The upload could not be read." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "The upload could not be read." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "That photo is too large." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) {
    return Response.json({ error: "Photos must be JPEG, PNG or WebP." }, { status: 415 });
  }

  try {
    const url = await putObject(`products/${randomUUID()}.${kind.extension}`, bytes, kind.type);
    return Response.json({ url });
  } catch (error) {
    console.error("[admin] Photo upload failed", error);
    return Response.json({ error: "The photo could not be stored. Try again." }, { status: 502 });
  }
}
