import { eq } from "drizzle-orm";
import type { Database } from "../index";
import { storeSettings } from "../schema";

export async function getSetting(db: Database, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: storeSettings.value })
    .from(storeSettings)
    .where(eq(storeSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db
    .insert(storeSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: storeSettings.key, set: { value, updatedAt: new Date() } });
}
