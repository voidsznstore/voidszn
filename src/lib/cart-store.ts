"use client";

import { useSyncExternalStore } from "react";
import { MAX_QUANTITY } from "./cart-limits";

/**
 * The cart lives in the browser. It stores only what was picked (product, color,
 * size, quantity), never a price. Names, pictures and prices shown in the cart
 * are looked up from the server, and checkout recalculates every total there.
 */
export type CartLine = {
  slug: string;
  color: string;
  size: string;
  quantity: number;
};

export { MAX_QUANTITY };

const STORAGE_KEY = "voidszn-cart-v1";
const EMPTY: CartLine[] = [];

let lines: CartLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

export function lineKey(line: Pick<CartLine, "slug" | "color" | "size">): string {
  return `${line.slug}:${line.color}:${line.size}`;
}

function isLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.slug === "string" &&
    typeof line.color === "string" &&
    typeof line.size === "string" &&
    typeof line.quantity === "number" &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0
  );
}

function read(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return EMPTY;
    // Saved data can be edited by hand, so the quantity limit is enforced on the way in too.
    return parsed
      .filter(isLine)
      .map((line) => ({ ...line, quantity: Math.min(line.quantity, MAX_QUANTITY) }));
  } catch {
    // Storage can be blocked or hold something unreadable. Start with an empty cart.
    return EMPTY;
  }
}

function commit(next: CartLine[]) {
  lines = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The cart still works for this visit even if it can't be saved.
  }
  listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent) {
  // Keep the cart in sync when it changes in another tab.
  if (event.key !== STORAGE_KEY) return;
  lines = read();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (!loaded) {
    lines = read();
    loaded = true;
  }
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

const clamp = (quantity: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)));

export function addToCart(line: Omit<CartLine, "quantity">, quantity = 1) {
  const key = lineKey(line);
  const existing = lines.find((item) => lineKey(item) === key);
  commit(
    existing
      ? lines.map((item) =>
          lineKey(item) === key ? { ...item, quantity: clamp(item.quantity + quantity) } : item,
        )
      : [...lines, { ...line, quantity: clamp(quantity) }],
  );
}

export function setQuantity(key: string, quantity: number) {
  commit(
    lines.map((item) => (lineKey(item) === key ? { ...item, quantity: clamp(quantity) } : item)),
  );
}

export function removeFromCart(key: string) {
  commit(lines.filter((item) => lineKey(item) !== key));
}

export function clearCart() {
  commit(EMPTY);
}

/** The saved cart as it is right now. For code that runs outside a component render. */
export function getCartLines(): CartLine[] {
  if (!loaded) {
    lines = read();
    loaded = true;
  }
  return lines;
}

/** Drops lines the server says can't be bought any more. */
export function removeUnavailable(keys: string[]) {
  if (keys.length === 0) return;
  const gone = new Set(keys);
  const next = lines.filter((item) => !gone.has(lineKey(item)));
  if (next.length !== lines.length) commit(next);
}

export function useCart() {
  // The server and the first client render both see an empty cart, so the page
  // hydrates cleanly. The saved cart appears right after.
  const stored = useSyncExternalStore(
    subscribe,
    () => lines,
    () => EMPTY,
  );

  return {
    lines: stored,
    count: stored.reduce((total, line) => total + line.quantity, 0),
  };
}
