import "server-only";
import { z } from "zod";
import type { Database } from "@/db";
import { getSetting, setSetting } from "@/db/queries/settings";
import { siteConfig } from "@/lib/site-config";

/** How the relay behaves, chosen on the Relay screen. Kept as one saved value. */

const KEY = "relay.settings";

const schema = z.object({
  /** Send each paid order to the printer without anyone pressing a button. */
  autoSend: z.boolean(),
  /**
   * When that was last switched on. Only orders paid from then on go by
   * themselves: switching it on must never send a backlog nobody looked at.
   */
  autoSince: z.string().datetime().nullable().default(null),
});

export type RelaySettings = z.infer<typeof schema>;

/**
 * Off to begin with: placing an order with the printer costs money, so nothing
 * goes by itself until the owner says so.
 */
export const DEFAULT_RELAY_SETTINGS: RelaySettings = { autoSend: false, autoSince: null };

/**
 * How long a paid order waits before going by itself: the time the store
 * promises customers they can still cancel in (`siteConfig.orders.cancelWindow`).
 */
export function holdMinutes(): number {
  const match = /^(\d+)\s*(minute|hour|day)s?$/i.exec(siteConfig.orders.cancelWindow.trim());
  if (!match) return 60;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * (unit === "minute" ? 1 : unit === "hour" ? 60 : 1440);
}

export async function getRelaySettings(db: Database): Promise<RelaySettings> {
  try {
    const raw = await getSetting(db, KEY);
    if (!raw) return DEFAULT_RELAY_SETTINGS;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.error("[relay] The saved relay settings can't be read. Sending by itself is treated as off.");
    return DEFAULT_RELAY_SETTINGS;
  } catch (error) {
    console.error("[relay] Could not load the relay settings. Sending by itself is treated as off.", error);
    return DEFAULT_RELAY_SETTINGS;
  }
}

/** Switches sending by itself on or off. Switching it on starts the clock afresh. */
export async function setAutoSend(db: Database, on: boolean): Promise<void> {
  const value: RelaySettings = { autoSend: on, autoSince: on ? new Date().toISOString() : null };
  await setSetting(db, KEY, JSON.stringify(schema.parse(value)));
}
