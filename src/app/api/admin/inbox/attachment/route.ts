import { getAdmin } from "@/lib/admin/session";
import { MailError, getAttachment, isInboxConfigured } from "@/lib/mail/gmail";

/**
 * Downloads one file attached to an email. Signed-in admins only. The file is
 * always sent as a download with a neutral type, never shown in the page, so an
 * attachment can't run as part of the admin.
 */
/** The full name for browsers that read it, or nothing if the name can't be encoded. */
function encodedName(name: string): string {
  try {
    return `; filename*=UTF-8''${encodeURIComponent(name)}`;
  } catch {
    return "";
  }
}

export async function GET(request: Request) {
  const admin = await getAdmin();
  if (!admin?.twoStep) return new Response("Sign in first.", { status: 401 });
  if (!isInboxConfigured()) return new Response("Not found", { status: 404 });

  const query = new URL(request.url).searchParams;
  const box = query.get("box") === "sent" ? "sent" : "inbox";
  const uid = Number(query.get("uid"));
  const index = Number(query.get("index"));
  if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(index) || index < 0 || index > 200) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await getAttachment(box, uid, index);
    if (!file) return new Response("Not found", { status: 404 });
    // Keep the name to plain characters for the header; the full name rides along encoded.
    const plain = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "attachment";
    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${plain}"${encodedName(file.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof MailError) return new Response(error.message, { status: 502 });
    throw error;
  }
}
