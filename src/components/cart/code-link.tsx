"use client";

import { useEffect, useState } from "react";
import { setDiscountCode } from "@/lib/cart-store";

type Note = { ok: boolean; text: string };

/**
 * Picks up a discount code from the address (`?code=SAVE20`), which is how links
 * in emails carry one. The code is checked, saved for checkout, and a short note
 * says so. Nothing is shown when there is no code in the address.
 */
export function CodeLink() {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("code");
    // Cart reminder links handle their own code.
    if (!raw || url.pathname.startsWith("/cart/")) return;

    // Tidy the address so the code isn't re-read on refresh or shared by accident.
    // From here the code only lives in this effect, so the lookup below must not
    // be abandoned if the effect is set up a second time.
    url.searchParams.delete("code");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);

    (async () => {
      try {
        const response = await fetch(`/api/discount/${encodeURIComponent(raw.slice(0, 40))}`);
        const data = (await response.json()) as
          | { ok: true; code: string; summary: string }
          | { ok: false; error: string };
        if (data.ok) {
          setDiscountCode(data.code);
          setNote({ ok: true, text: `${data.code}: ${data.summary}. It comes off at checkout.` });
        } else {
          setNote({ ok: false, text: data.error });
        }
      } catch {
        // No note is better than a wrong one.
      }
    })();
  }, []);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 9000);
    return () => window.clearTimeout(timer);
  }, [note]);

  if (!note) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-50 flex justify-center">
      <p
        role="status"
        className="glass glass-deep pointer-events-auto flex max-w-lg items-center gap-3 rounded-full py-2 pl-5 pr-2 text-sm"
      >
        <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${note.ok ? "bg-ember shadow-[0_0_12px_var(--glow)]" : "bg-smoke"}`} />
        <span className="min-w-0">{note.text}</span>
        <button type="button" onClick={() => setNote(null)} className="btn btn-glass btn-sm min-h-9 flex-none px-4">
          OK
        </button>
      </p>
    </div>
  );
}
