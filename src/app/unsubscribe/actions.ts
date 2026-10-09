"use server";

import { getDb } from "@/db";
import { emailForToken, optOut } from "@/db/queries/admin-campaigns";

export type UnsubscribeState = { done?: boolean; error?: string };

export async function unsubscribeAction(
  _previous: UnsubscribeState,
  form: FormData,
): Promise<UnsubscribeState> {
  const token = form.get("token");
  const db = getDb();
  const email = typeof token === "string" ? await emailForToken(db, token) : null;
  if (!email) return { error: "This unsubscribe link isn't valid any more." };
  await optOut(db, email, "link");
  return { done: true };
}
