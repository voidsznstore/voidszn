import { getDb } from "@/db";
import { emailForToken, optOut } from "@/db/queries/admin-campaigns";

/**
 * The address behind the unsubscribe button mail apps show on marketing email.
 * The mail app posts here and the person is unsubscribed in one click, with no
 * page to visit. Only POST does anything, so a link scanner can't unsubscribe anyone.
 */
export async function POST(_request: Request, { params }: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await params;
  const db = getDb();
  const email = await emailForToken(db, token);
  // Always the same answer, so the address can't be probed for which links are real.
  if (email) await optOut(db, email, "one_click");
  return new Response(null, { status: 200 });
}

/**
 * Some mail apps open the address in a browser instead of posting to it. Opening
 * it changes nothing: it just leads to the page with the unsubscribe button.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await params;
  const safe = /^[A-Za-z0-9_-]{1,64}$/.test(token) ? token : "invalid";
  return Response.redirect(new URL(`/unsubscribe/${safe}`, request.url), 303);
}
