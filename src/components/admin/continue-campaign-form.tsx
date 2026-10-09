"use client";

import { continueCampaignAction } from "@/app/admin/(panel)/campaigns/actions";
import { useFormAction } from "./use-form-action";

/** Carries on sending a campaign that stopped part-way. */
export function ContinueCampaignForm({ id, waiting }: { id: string; waiting: number }) {
  const { state, action, pending, onSubmit } = useFormAction(continueCampaignAction, {});
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent min-h-11 px-5">
          {pending ? "Sending…" : `Continue sending (${waiting} to go)`}
        </button>
        <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? state.done ?? ""}
        </p>
      </div>
    </form>
  );
}
