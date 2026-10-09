"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

export type SortableItem = {
  id: string;
  title: string;
  /** Small note shown after the title, e.g. "12 products" or "Hidden". */
  note?: string;
  href?: string;
};

type SortableListProps = {
  items: SortableItem[];
  /** Saves the new order. Gets every id, first to last. */
  save: (ids: string[]) => Promise<{ ok: boolean }>;
  /** What one row is, for screen readers. e.g. "category". */
  noun: string;
};

/**
 * A list that can be put in order by dragging rows, or with the up and down
 * buttons (which is how it works on a phone or with a keyboard). Each change is
 * saved straight away.
 */
export function SortableList({ items, save, noun }: SortableListProps) {
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, startTransition] = useTransition();

  // New rows from the server (something was added or removed) replace the local order.
  const signature = items.map((item) => `${item.id}:${item.title}:${item.note ?? ""}`).join("|");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setOrder(items);
  }

  function commit(next: SortableItem[]) {
    setOrder(next);
    startTransition(async () => {
      const result = await save(next.map((item) => item.id)).catch(() => ({ ok: false }));
      setStatus(result.ok ? "saved" : "failed");
    });
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  }

  if (order.length === 0) return <p className="text-bone-dim">Nothing here yet.</p>;

  return (
    <div className="flex flex-col gap-2">
      <ol className="border-t border-line">
        {order.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={(event) => {
              setDragging(item.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              if (dragging && dragging !== item.id) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = order.findIndex((candidate) => candidate.id === dragging);
              setDragging(null);
              if (from !== -1) move(from, index);
            }}
            className={`flex min-h-14 items-center gap-3 border-b border-line ${
              dragging === item.id ? "opacity-40" : ""
            }`}
          >
            <span aria-hidden="true" className="cursor-grab select-none px-1 text-smoke" title="Drag to reorder">
              ⠿
            </span>
            <span className="min-w-0 flex-1">
              {item.href ? (
                <Link href={item.href} className="font-semibold underline-offset-4 hover:underline">
                  {item.title}
                </Link>
              ) : (
                <span className="font-semibold">{item.title}</span>
              )}
              {item.note ? <span className="ml-3 text-sm text-smoke">{item.note}</span> : null}
            </span>
            <button
              type="button"
              aria-label={`Move ${noun} ${item.title} up`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
              className="h-11 w-11 border border-line-strong disabled:border-line disabled:text-line-strong"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${noun} ${item.title} down`}
              disabled={index === order.length - 1}
              onClick={() => move(index, index + 1)}
              className="h-11 w-11 border border-line-strong disabled:border-line disabled:text-line-strong"
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="min-h-5 text-sm text-smoke">
        {pending
          ? "Saving…"
          : status === "saved"
            ? "Order saved."
            : status === "failed"
              ? "The order could not be saved. Refresh and try again."
              : ""}
      </p>
    </div>
  );
}
