"use client";

import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import { setDiscountCode } from "@/lib/cart-store";
import type { LivePopup } from "@/lib/popups/shape";
import { siteConfig } from "@/lib/site-config";

type Joined = { code: string | null; summary: string | null; firstOrderOnly: boolean };

/**
 * What a pop-up looks like and does. On the store it sits inside a dialog; in
 * the admin it is drawn on its own as a preview, where nothing it does is real.
 */
export function PopupCard({
  popup,
  headingId,
  onClose,
  onJoined,
  preview = false,
}: {
  popup: LivePopup;
  headingId: string;
  onClose: () => void;
  /** Called once someone has signed up, so the store stops asking them. */
  onJoined?: () => void;
  preview?: boolean;
}) {
  return (
    <div className="relative flex flex-col gap-5 p-7 pt-9 sm:p-9 sm:pt-10">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2.5 top-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-bone-dim transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <svg aria-hidden="true" viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1 1l12 12M13 1 1 13" />
        </svg>
      </button>

      <div className="flex flex-col gap-3 pr-6">
        {popup.eyebrow ? <p className="label text-ember">{popup.eyebrow}</p> : null}
        <h2 id={headingId} className="display text-[2.5rem] leading-[0.95] text-white sm:text-5xl">
          {popup.headline}
        </h2>
        {popup.body ? <p className="text-bone-dim">{popup.body}</p> : null}
      </div>

      {popup.kind === "EMAIL" ? (
        <SignUp popup={popup} onClose={onClose} onJoined={onJoined} preview={preview} />
      ) : popup.kind === "CODE" ? (
        <CodeOffer popup={popup} onClose={onClose} preview={preview} />
      ) : (
        <div className="flex flex-col gap-2">
          <Link
            href={preview ? "#" : (popup.buttonUrl ?? "/")}
            onClick={(event) => {
              if (preview) event.preventDefault();
              else onClose();
            }}
            className="btn btn-accent w-full"
          >
            {popup.buttonLabel}
          </Link>
          <NoThanks onClose={onClose} />
        </div>
      )}
    </div>
  );
}

function NoThanks({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="mx-auto inline-flex min-h-11 items-center text-sm text-smoke link">
      No thanks
    </button>
  );
}

/** A code in a box, with a button to copy it. */
function CodeBox({ code, summary }: { code: string; summary: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="well flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="flex min-w-0 flex-col">
        <span className="num break-all text-2xl font-semibold tracking-[0.12em] text-white">{code}</span>
        {summary ? <span className="text-sm text-bone-dim">{summary}</span> : null}
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            // Copying is a nicety. The code is on screen and already saved for checkout.
          }
        }}
        className="btn btn-glass btn-sm flex-none"
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

function CodeOffer({ popup, onClose, preview }: { popup: LivePopup; onClose: () => void; preview: boolean }) {
  const offer = popup.offer ?? { code: "YOURCODE", summary: "Pick a code to see what it gives" };
  const href = popup.buttonUrl;
  const use = () => {
    if (preview) return;
    setDiscountCode(offer.code);
    onClose();
  };
  return (
    <div className="flex flex-col gap-3">
      <CodeBox code={offer.code} summary={offer.summary} />
      {href && !preview ? (
        <Link href={href} onClick={use} className="btn btn-accent w-full">
          {popup.buttonLabel}
        </Link>
      ) : (
        <button type="button" onClick={use} className="btn btn-accent w-full">
          {popup.buttonLabel}
        </button>
      )}
      <p className="text-center text-[0.8125rem] text-smoke">The button saves the code. It comes off at checkout.</p>
    </div>
  );
}

function SignUp({
  popup,
  onClose,
  onJoined,
  preview,
}: {
  popup: LivePopup;
  onClose: () => void;
  onJoined?: () => void;
  preview: boolean;
}) {
  const emailId = useId();
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/popups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          popupId: popup.id,
          email: String(form.get("email") ?? ""),
          website: String(form.get("website") ?? ""),
        }),
      });
      const result = (await response.json()) as ({ ok: true } & Joined) | { ok: false; error: string };
      if (result.ok) {
        // Saved for checkout, so it comes off without them typing it.
        if (result.code) setDiscountCode(result.code);
        setJoined({ code: result.code, summary: result.summary, firstOrderOnly: result.firstOrderOnly });
        onJoined?.();
      } else {
        setError(result.error);
      }
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (joined) {
    return (
      <div className="flex flex-col gap-3" role="status">
        {joined.code ? (
          <>
            <p className="font-semibold text-white">You&apos;re in. Here&apos;s your code:</p>
            <CodeBox code={joined.code} summary={joined.summary} />
            <p className="text-sm text-bone-dim">
              It&apos;s saved for you and comes off at checkout.
              {joined.firstOrderOnly ? " Good for your first order." : ""}
            </p>
          </>
        ) : (
          <p className="font-semibold text-white">You&apos;re in. We&apos;ll be in touch.</p>
        )}
        <button type="button" onClick={onClose} className="btn btn-accent w-full">
          Keep shopping
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <label htmlFor={emailId} className="sr-only">
        Email address
      </label>
      <input
        id={emailId}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        maxLength={254}
        placeholder="you@example.com"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="input"
      />
      {/* Hidden from people. Only a script fills it in, and its sign-up is thrown away. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "One moment…" : popup.buttonLabel}
      </button>
      <p id={errorId} role="alert" className={error ? "text-sm text-ember" : "sr-only"}>
        {error}
      </p>
      <p className="text-[0.8125rem] leading-relaxed text-smoke">
        By signing up you agree to get marketing emails from {siteConfig.name}. Unsubscribe any time.{" "}
        {preview ? (
          <span className="link">Privacy Policy</span>
        ) : (
          <Link href="/privacy" onClick={onClose} className="link">
            Privacy Policy
          </Link>
        )}
        .
      </p>
      <NoThanks onClose={onClose} />
    </form>
  );
}
