"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A delete button that asks first. The first click swaps it for a confirm and a
 * cancel; only the confirm submits the form it sits in.
 */
export function ConfirmButton({ label, confirmLabel }: { label: string; confirmLabel: string }) {
  const [asking, setAsking] = useState(false);
  const { pending } = useFormStatus();

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="inline-flex min-h-11 items-center text-sm text-smoke underline underline-offset-4 hover:text-bone"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className="btn btn-outline min-h-11 px-5 disabled:opacity-60">
        {pending ? "Deleting…" : confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Cancel
      </button>
    </span>
  );
}
