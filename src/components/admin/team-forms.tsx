"use client";

import { useRouter } from "next/navigation";
import {
  type TeamFormState,
  inviteAction,
  resendInviteAction,
  setAccessAction,
} from "@/app/admin/(panel)/team/actions";
import { useFormAction } from "./use-form-action";

const initial: TeamFormState = {};

function Result({ state }: { state: TeamFormState }) {
  return (
    <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
      {state.error ?? state.done ?? ""}
    </p>
  );
}

/** Adds someone to the admin. Each visit to the page starts with empty boxes. */
export function InviteForm() {
  const { bfcacheId } = useRouter();
  return <Invite key={bfcacheId} />;
}

function Invite() {
  const { state, action, pending, onSubmit } = useFormAction(inviteAction, initial);
  return (
    <form
      // The boxes empty once an invitation has gone.
      key={state.done ?? "editing"}
      action={action}
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Name
          <input name="name" required maxLength={100} autoComplete="off" className="input" />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Email
          <input name="email" type="email" required maxLength={254} autoComplete="off" className="input" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Sending…" : "Send invitation"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function ResendInviteButton({ id }: { id: string }) {
  const { state, action, pending, onSubmit } = useFormAction(resendInviteAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn btn-glass btn-sm">
        {pending ? "Sending…" : "Send again"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function AccessButton({ id, name, allowed }: { id: string; name: string; allowed: boolean }) {
  const { state, action, pending, onSubmit } = useFormAction(setAccessAction, initial);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (allowed && !window.confirm(`Remove ${name}'s access? They are signed out straight away.`)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="allowed" value={allowed ? "no" : "yes"} />
      <button type="submit" disabled={pending} className="btn btn-glass btn-sm">
        {pending ? "Saving…" : allowed ? "Remove access" : "Give access back"}
      </button>
      <Result state={state} />
    </form>
  );
}
