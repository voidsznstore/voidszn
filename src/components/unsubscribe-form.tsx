"use client";

import { useActionState } from "react";
import { type UnsubscribeState, unsubscribeAction } from "@/app/unsubscribe/actions";

const initial: UnsubscribeState = {};

export function UnsubscribeForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(unsubscribeAction, initial);

  if (state.done) {
    return (
      <p role="status" className="text-bone-dim">
        Done. {email} won&apos;t get marketing emails from us any more. You&apos;ll still get
        emails about orders you place.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col items-start gap-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-bone-dim">Stop sending marketing emails to {email}?</p>
      <button type="submit" disabled={pending} className="btn btn-accent disabled:opacity-60">
        {pending ? "Unsubscribing…" : "Unsubscribe"}
      </button>
      <p role="alert" className="text-sm text-accent">
        {state.error}
      </p>
    </form>
  );
}
