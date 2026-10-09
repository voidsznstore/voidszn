"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { NavLink } from "@/lib/navigation";

/**
 * A header link that opens a small sheet of glass with more links under it:
 * "Category" and "Interest". Opens on click or on hover with a mouse, and
 * closes on Escape, on a click elsewhere, or once a link is followed.
 */
export function NavMenu({ label, links, allHref }: { label: string; links: NavLink[]; allHref: string }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  // True while a mouse rests on the menu, which has already opened it.
  const hovering = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      wrapper.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  if (links.length === 0) return null;

  return (
    <div
      ref={wrapper}
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        hovering.current = true;
        cancelClose();
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        hovering.current = false;
        cancelClose();
        // A beat of grace, so crossing the gap to the menu doesn't close it.
        closeTimer.current = window.setTimeout(() => setOpen(false), 140);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // Hovering has already opened it, so a mouse click must not shut it again.
        onClick={() => setOpen((value) => (hovering.current ? true : !value))}
        className={`inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors hover:bg-white/[0.07] hover:text-white ${
          open ? "bg-white/[0.07] text-white" : "text-bone-dim"
        }`}
      >
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 8"
          className={`h-2 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1.5 6 6.5l5-5" />
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="glass glass-solid absolute left-1/2 top-full z-50 mt-2 w-60 -translate-x-1/2 rounded-[1.25rem] p-2"
      >
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-xl px-3.5 text-[0.9375rem] font-semibold text-bone-dim transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={allHref}
          onClick={() => setOpen(false)}
          className="mt-1 flex min-h-11 items-center border-t border-line px-3.5 text-sm text-smoke transition-colors hover:text-white"
        >
          Shop everything
        </Link>
      </div>
    </div>
  );
}
