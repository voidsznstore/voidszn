import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

// Reuse one pool across hot reloads and warm serverless invocations.
const globalForDb = globalThis as unknown as { voidsznPool?: Pool; voidsznDb?: Database };

/** Whether a database is configured at all. False on a fresh local checkout. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
}

/**
 * Returns the database client. Created on first use so builds and pages that
 * never touch the database do not need DATABASE_URL.
 */
export function getDb(): Database {
  if (globalForDb.voidsznDb) return globalForDb.voidsznDb;

  // Hosting integrations name this differently, so accept the common ones.
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  const pool = new Pool({ connectionString, max: 5 });
  globalForDb.voidsznPool = pool;
  globalForDb.voidsznDb = drizzle({ client: pool, schema });
  return globalForDb.voidsznDb;
}

export { schema };
