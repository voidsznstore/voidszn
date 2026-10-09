"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { ordersToRelay } from "@/db/queries/relay";
import { requireAdmin } from "@/lib/admin/session";
import { followRelayedOrders, sendOrderToRelay } from "@/lib/relay/orders";
import { syncCatalogToRelay } from "@/lib/relay/products";
import { holdMinutes, setAutoSend } from "@/lib/relay/settings";
import { isRelayConfigured } from "@/lib/relay/woo";

export type RelayFormState = { error?: string; done?: string; at?: number };

const NOT_CONNECTED = "The relay store isn't connected yet. Follow the set-up steps below first.";
/** Long enough to get real work done, short enough that the page always gets an answer. */
const BUDGET_MS = 40_000;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Switches sending paid orders by themselves on or off. */
export async function autoSendAction(_previous: RelayFormState, form: FormData): Promise<RelayFormState> {
  await requireAdmin();
  const autoSend = form.get("turn") === "on";
  if (autoSend && !isRelayConfigured()) return { error: NOT_CONNECTED };
  await setAutoSend(getDb(), autoSend);
  refresh();
  const hold = holdMinutes();
  const wait = hold >= 60 && hold % 60 === 0 ? plural(hold / 60, "hour", "hours") : plural(hold, "minute", "minutes");
  return {
    done: autoSend
      ? `On. Orders paid from now on go to the printer by themselves, ${wait} after payment. Orders already waiting stay until you send them.`
      : "Off. Orders wait until you send them.",
    at: Date.now(),
  };
}

/** Copies new and changed products to the relay store, as many as fit in one go. */
export async function copyProductsAction(): Promise<RelayFormState> {
  await requireAdmin();
  if (!isRelayConfigured()) return { error: NOT_CONNECTED };
  const result = await syncCatalogToRelay(BUDGET_MS);
  refresh();
  const parts = [
    result.copied > 0 ? `${plural(result.copied, "product", "products")} copied` : "",
    result.failed > 0 ? `${result.failed} couldn't be copied (listed below)` : "",
    result.left > 0 ? `${result.left} still to go, press again to carry on` : "",
  ].filter(Boolean);
  if (parts.length === 0) return { done: "Everything is already there. Nothing to copy.", at: Date.now() };
  return result.failed > 0 && result.copied === 0
    ? { error: `${parts.join(". ")}.`, at: Date.now() }
    : { done: `${parts.join(". ")}.`, at: Date.now() };
}

/** Sends every order that is waiting, now, whether or not sending by itself is on. */
export async function sendWaitingAction(): Promise<RelayFormState> {
  const admin = await requireAdmin();
  if (!isRelayConfigured()) return { error: NOT_CONNECTED };
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  for (const id of await ordersToRelay(getDb(), 40, { kind: "everything" })) {
    if (Date.now() - started >= BUDGET_MS) break;
    try {
      const outcome = await sendOrderToRelay(id, admin.email);
      if (outcome.ok) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  refresh();
  if (sent === 0 && failed === 0) return { done: "No orders are waiting.", at: Date.now() };
  const summary = `${plural(sent, "order", "orders")} sent to the printer${failed > 0 ? `, ${failed} not sent (listed below)` : ""}.`;
  return failed > 0 && sent === 0 ? { error: summary, at: Date.now() } : { done: summary, at: Date.now() };
}

/** Asks the relay store about orders with the printer now, instead of waiting for the timed check. */
export async function checkShippedAction(): Promise<RelayFormState> {
  await requireAdmin();
  if (!isRelayConfigured()) return { error: NOT_CONNECTED };
  const result = await followRelayedOrders(BUDGET_MS, 100);
  refresh();
  if (result.shipped === 0 && result.problems === 0) return { done: "Checked. Nothing new from the printer.", at: Date.now() };
  return {
    done: `${plural(result.shipped, "order", "orders")} marked as shipped${result.problems > 0 ? `, ${result.problems} need a look (listed below)` : ""}.`,
    at: Date.now(),
  };
}
