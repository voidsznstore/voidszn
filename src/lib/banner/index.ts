import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { type Database, getDb, hasDatabase } from "@/db";
import { getSetting, setSetting } from "@/db/queries/settings";
import { BANNER_LIMITS, BANNER_TAG, type Banner, DEFAULT_BANNER, isHexColor } from "./shape";

const KEY = "store.banner";

const schema = z.object({
  enabled: z.boolean(),
  messages: z.array(z.string().trim().min(1).max(BANNER_LIMITS.length)).max(BANNER_LIMITS.messages),
  color: z.string().refine(isHexColor),
});

async function readBanner(db: Database): Promise<Banner> {
  try {
    const raw = await getSetting(db, KEY);
    if (!raw) return DEFAULT_BANNER;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_BANNER;
  } catch {
    return DEFAULT_BANNER;
  }
}

/**
 * The banner as the store shows it. Kept in the cache so pages don't ask the
 * database on every visit; saving it in the admin clears the cache at once.
 */
export async function getBanner(): Promise<Banner> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86_400 });
  cacheTag(BANNER_TAG);
  if (!hasDatabase()) return DEFAULT_BANNER;
  return readBanner(getDb());
}

/** The banner straight from the database, for the admin form. */
export const getBannerForAdmin = (db: Database) => readBanner(db);

export async function saveBanner(db: Database, value: Banner): Promise<void> {
  await setSetting(db, KEY, JSON.stringify(schema.parse(value)));
}
