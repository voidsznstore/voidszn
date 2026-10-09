"use server";

import { refresh, updateTag } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/session";
import { saveBanner } from "@/lib/banner";
import { BANNER_LIMITS, BANNER_TAG, isHexColor } from "@/lib/banner/shape";

export type BannerFormState = { error?: string; saved?: boolean };

/** Saves what the moving banner says and its color, and shows it on the store at once. */
export async function saveBannerAction(_previous: BannerFormState, form: FormData): Promise<BannerFormState> {
  await requireAdmin();

  const messages = String(form.get("messages") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const enabled = form.get("enabled") === "on";
  const color = String(form.get("color") ?? "").trim();

  if (enabled && messages.length === 0) {
    return { error: "Write at least one line for the banner, or switch it off." };
  }
  if (messages.length > BANNER_LIMITS.messages) {
    return { error: `The banner holds up to ${BANNER_LIMITS.messages} lines.` };
  }
  const long = messages.find((line) => line.length > BANNER_LIMITS.length);
  if (long) {
    return { error: `Keep each line under ${BANNER_LIMITS.length} characters. "${long.slice(0, 30)}…" is too long.` };
  }
  if (!isHexColor(color)) return { error: "Pick a color for the text." };

  await saveBanner(getDb(), { enabled, messages, color: color.toUpperCase() });
  updateTag(BANNER_TAG);
  refresh();
  return { saved: true };
}
