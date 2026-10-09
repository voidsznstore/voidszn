import { hasDatabase } from "@/db";
import { joinFromPopup } from "@/lib/popups/join";

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });

/**
 * Signs someone up through an email pop-up. Takes the pop-up's id and an email
 * address, and answers with the code that pop-up gives.
 */
export async function POST(request: Request) {
  if (!hasDatabase()) return fail("Sign-ups aren't open yet.", 503);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2000) return fail("That didn't go through. Try again.", 413);
    body = JSON.parse(raw);
  } catch {
    return fail("That didn't go through. Try again.", 400);
  }
  const { popupId, email, website } = (body ?? {}) as Record<string, unknown>;
  if (typeof popupId !== "string" || typeof email !== "string") {
    return fail("Enter your email address, like name@example.com.", 400);
  }
  // A field people never see. Only a script fills it in.
  if (typeof website === "string" && website.trim() !== "") {
    return fail("That didn't go through. Try again.", 400);
  }

  try {
    const result = await joinFromPopup(popupId, email);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error("[popups] A sign-up failed", error);
    return fail("That didn't go through. Try again in a moment.", 500);
  }
}
