import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Same files Next.js reads, in the same priority order.
config({ path: [".env.local", ".env"] });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
