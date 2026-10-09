"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { type LivePopup, isQuietPath, matchesPages } from "@/lib/popups/shape";
import { PopupCard } from "./popup-card";

/**
 * What this browser remembers about pop-ups: when each was last closed, and
 * whether its owner has signed up. Kept in the browser only; nothing is sent anywhere.
 */
const MEMORY_KEY = "voidszn-popups-v1";
/** Set once a pop-up has opened in this visit, so a second one never follows it. */
const VISIT_KEY = "voidszn-popup-seen";
const DAY_MS = 24 * 60 * 60 * 1000;

type Memory = { closed: Record<string, number>; joined: boolean };

function readMemory(): Memory {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MEMORY_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const { closed, joined } = parsed as { closed?: unknown; joined?: unknown };
      const times: Record<string, number> = {};
      if (closed && typeof closed === "object") {
        for (const [id, at] of Object.entries(closed)) if (typeof at === "number") times[id] = at;
      }
      return { closed: times, joined: joined === true };
    }
  } catch {
    // Unreadable or blocked storage is the same as none.
  }
  return { closed: {}, joined: false };
}

function remember(change: (memory: Memory) => void) {
  try {
    const memory = readMemory();
    change(memory);
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Without storage the pop-up may come back another day. That is all.
  }
}

function seenThisVisit(): boolean {
  try {
    return window.sessionStorage.getItem(VISIT_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen(id: string) {
  try {
    window.sessionStorage.setItem(VISIT_KEY, id);
  } catch {
    // Nothing to do.
  }
}

/** The first pop-up that fits this page and that this person hasn't dealt with. */
function choose(popups: LivePopup[], pathname: string, now: number): LivePopup | null {
  if (isQuietPath(pathname) || seenThisVisit()) return null;
  const memory = readMemory();
  return (
    popups.find((popup) => {
      if (!matchesPages(popup.pages, pathname)) return false;
      if (popup.kind === "EMAIL" && memory.joined) return false;
      const closedAt = memory.closed[popup.id];
      return closedAt === undefined || now - closedAt >= popup.showAgainDays * DAY_MS;
    }) ?? null
  );
}

/** True while it would be rude to open: another dialog is up, or they are typing. */
function isBusy(): boolean {
  if (document.querySelector("dialog[open]")) return true;
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Opens the store's pop-ups at the right moment. One per visit at most, never
 * at checkout, and never again for someone who closed it until its wait is up.
 */
export function PopupHost({ popups }: { popups: LivePopup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<LivePopup | null>(null);

  useEffect(() => {
    if (open) return;
    const popup = choose(popups, pathname, Date.now());
    if (!popup) return;

    let timer: number | undefined;
    const undo: (() => void)[] = [];

    const show = () => {
      if (isBusy()) {
        timer = window.setTimeout(show, 4000);
        return;
      }
      if (seenThisVisit()) return;
      markSeen(popup.id);
      setOpen(popup);
    };
    const after = (seconds: number) => {
      timer = window.setTimeout(show, seconds * 1000);
    };

    if (popup.trigger === "DELAY") {
      after(popup.delaySeconds);
    } else if (popup.trigger === "SCROLL") {
      const room = () => document.documentElement.scrollHeight - window.innerHeight;
      if (room() < 200) {
        // Nothing to scroll on a short page.
        after(8);
      } else {
        const onScroll = () => {
          if (window.scrollY < room() * 0.5) return;
          window.removeEventListener("scroll", onScroll);
          show();
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        undo.push(() => window.removeEventListener("scroll", onScroll));
      }
    } else if (window.matchMedia("(hover: none)").matches) {
      // A phone has no mouse to watch leave, so wait a while instead.
      after(20);
    } else {
      // A moment's grace, so a slip of the mouse on arrival doesn't count as leaving.
      const armedAt = Date.now() + 3000;
      const onLeave = (event: MouseEvent) => {
        if (event.relatedTarget !== null || event.clientY > 0 || Date.now() < armedAt) return;
        document.removeEventListener("mouseout", onLeave);
        show();
      };
      document.addEventListener("mouseout", onLeave);
      undo.push(() => document.removeEventListener("mouseout", onLeave));
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      for (const stop of undo) stop();
    };
  }, [popups, pathname, open]);

  if (!open) return null;
  return (
    <PopupDialog
      key={open.id}
      popup={open}
      onJoined={() => remember((memory) => void (memory.joined = true))}
      onClose={() => {
        remember((memory) => void (memory.closed[open.id] = Date.now()));
        setOpen(null);
      }}
    />
  );
}

function PopupDialog({
  popup,
  onClose,
  onJoined,
}: {
  popup: LivePopup;
  onClose: () => void;
  onJoined: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  // A native dialog gives focus trapping, Escape to close and a backdrop for free.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // With a keyboard to hand, start in the email field. A phone would throw its keyboard up, so not there.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      dialog.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dimmed area outside the card closes it.
        if (event.target === ref.current) ref.current?.close();
      }}
      className="popup glass glass-solid m-auto w-[calc(100vw-1.5rem)] max-w-[27rem] rounded-[1.75rem] p-0 text-bone backdrop:bg-black/65 backdrop:backdrop-blur-sm"
    >
      <PopupCard popup={popup} headingId={headingId} onClose={() => ref.current?.close()} onJoined={onJoined} />
    </dialog>
  );
}
