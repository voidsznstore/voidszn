"use client";

import { useEffect, useState } from "react";

/** How long a page is given before the same address may be reloaded automatically again. */
const RETRY_WINDOW_MS = 30_000;
const STORAGE_KEY = "voidszn-reload";

/**
 * What a visitor sees when a page fails to load. Used by the error page inside
 * the site's frame and by the one that stands in for the whole frame.
 *
 *
 * The first time it happens on an address, the page is quietly loaded again
 * from scratch, which is all that is needed in the one case this is known to
 * happen: for a moment after a change is saved in the admin, a link followed
 * before the page behind it has been rebuilt can get half an answer. A full
 * load always gets the whole page. If it fails again straight away, this says
 * so and lets the visitor decide.
 */
/**
 * True when this address was already reloaded a moment ago, or when the browser
 * won't let us remember that it was. Either way, reloading again could loop.
 */
function alreadyTried(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}") as {
      url?: string;
      at?: number;
    };
    return last.url === window.location.href && Date.now() - (last.at ?? 0) < RETRY_WINDOW_MS;
  } catch {
    return true;
  }
}

export function LoadError({ error }: { error: Error & { digest?: string } }) {
  // Decided once, when the error first shows.
  const [gaveUp] = useState(alreadyTried);

  useEffect(() => {
    console.error(error);
    if (gaveUp) return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ url: window.location.href, at: Date.now() }),
      );
    } catch {
      // Nowhere to note the attempt (private mode). One reload is still worth it:
      // if it fails again, `alreadyTried` answers yes and the message shows.
    }
    window.location.reload();
  }, [error, gaveUp]);

  // While the reload is on its way, show nothing rather than flash an error.
  if (!gaveUp) return <div className="min-h-[70vh] flex-1" aria-busy="true" />;

  return (
    <main className="mx-auto flex w-full max-w-site flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center sm:px-10">
      <h1 className="display text-[clamp(2.5rem,8vw,4.5rem)] text-white">That didn&apos;t load</h1>
      <p className="max-w-md text-balance text-lg text-bone-dim">
        Something went wrong on our side. Your cart is safe. Try the page again.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => window.location.reload()} className="btn btn-accent">
          Try again
        </button>
        {/* A plain link: this can be shown where the site's own navigation has failed. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="btn btn-glass">
          Back to the store
        </a>
      </div>
    </main>
  );
}
