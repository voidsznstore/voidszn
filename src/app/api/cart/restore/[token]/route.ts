import { getDb, hasDatabase } from "@/db";
import { findCartByToken } from "@/db/queries/carts";

/** Hands back the cart behind a link in a reminder email, so the browser can refill it. */
export async function GET(_request: Request, context: RouteContext<"/api/cart/restore/[token]">) {
  const { token } = await context.params;
  if (!hasDatabase()) return Response.json({ error: "Not found" }, { status: 404 });

  const cart = await findCartByToken(getDb(), token);
  if (!cart) return Response.json({ error: "Not found" }, { status: 404 });
  if (cart.status === "RECOVERED") return Response.json({ ordered: true });

  return Response.json({
    lines: cart.items.map((item) => ({
      slug: item.slug,
      color: item.color,
      size: item.size,
      quantity: item.quantity,
    })),
  });
}
