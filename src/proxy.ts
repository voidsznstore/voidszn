import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin/cookie";

/**
 * A quick first check for the admin: no session cookie, no admin screens. This
 * only looks at whether the cookie is there. The real check, against the
 * database, happens on every admin page and action.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/admin/login" || pathname === "/admin/setup";

  if (!isPublic && !request.cookies.has(ADMIN_COOKIE)) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
