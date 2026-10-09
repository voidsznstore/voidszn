import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { getSquareStatus } from "@/lib/payments/square";
import { checkStorage } from "@/lib/storage";

/**
 * Deploy check. Reports whether the site can reach its database, how many tables
 * exist, and which payment settings are in place. Returns no secrets and no error
 * details.
 */
export async function GET() {
  // Always answer from the live database, never from a prerendered copy.
  await connection();

  const [square, images] = await Promise.all([getSquareStatus(), checkStorage()]);
  const payments = { ...square, images };

  const configured = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
  if (!configured) {
    return Response.json({ database: "not configured", ...payments }, { status: 503 });
  }

  try {
    const result = await getDb().execute<{ count: number }>(
      sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    );
    return Response.json({ database: "ok", tables: result.rows[0]?.count ?? 0, ...payments });
  } catch {
    return Response.json({ database: "unreachable", ...payments }, { status: 503 });
  }
}
