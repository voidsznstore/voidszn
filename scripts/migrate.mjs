/**
 * Applies pending database migrations. Runs before every build.
 *
 * - No DATABASE_URL: does nothing, so the site still builds before a database exists.
 * - Vercel preview deploys: does nothing, so a branch can never change the live database.
 * - Production deploys (and local runs with DATABASE_URL set): applies what is pending.
 *   If a migration fails, the build fails and the previous version of the site stays live.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
const vercelEnv = process.env.VERCEL_ENV;

if (!url) {
  console.log("[migrate] DATABASE_URL is not set. Skipping.");
  process.exit(0);
}

if (vercelEnv && vercelEnv !== "production") {
  console.log(`[migrate] ${vercelEnv} deploy. Skipping.`);
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("[migrate] Database is up to date.");
} finally {
  await pool.end();
}
