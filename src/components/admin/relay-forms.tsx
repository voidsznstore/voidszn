"use client";

import {
  type RelayFormState,
  autoSendAction,
  checkShippedAction,
  copyProductsAction,
  sendWaitingAction,
} from "@/app/admin/(panel)/relay/actions";
import { useFormAction } from "./use-form-action";

const initial: RelayFormState = {};

function Result({ state, pending }: { state: RelayFormState; pending: boolean }) {
  return (
    <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
      {pending ? "" : (state.error ?? state.done ?? "")}
    </p>
  );
}

/** The switch for sending paid orders to the printer without anyone pressing a button. */
export function AutoSendSwitch({ on, disabled }: { on: boolean; disabled: boolean }) {
  const { state, action, pending, onSubmit } = useFormAction(autoSendAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="turn" value={on ? "off" : "on"} />
      <div className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-lg font-semibold text-white">Send paid orders by themselves</span>
          <span className="text-[0.8125rem] text-smoke">
            Off: each order waits for you to press “Send to the printer”. On: orders paid from then on go by
            themselves, once the time a customer has to cancel is up.
          </span>
        </span>
        <button
          type="submit"
          role="switch"
          aria-checked={on}
          aria-label="Send paid orders by themselves"
          disabled={pending || disabled}
          className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition-colors disabled:opacity-50 ${
            on ? "border-white/25 bg-accent shadow-[0_0_16px_-4px_var(--glow)]" : "border-line-strong bg-white/[0.06]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-5 w-5 rounded-full bg-bone shadow transition-transform ${on ? "translate-x-[1.375rem]" : "translate-x-1"}`}
          />
        </button>
      </div>
      <Result state={state} pending={pending} />
    </form>
  );
}

type Run = () => Promise<RelayFormState>;

function RunButton({
  run,
  label,
  busy,
  tone = "glass",
  disabled = false,
}: {
  run: Run;
  label: string;
  busy: string;
  tone?: "accent" | "glass";
  disabled?: boolean;
}) {
  const { state, action, pending, onSubmit } = useFormAction(run, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="submit" disabled={pending || disabled} className={`btn ${tone === "accent" ? "btn-accent" : "btn-glass"}`}>
        {pending ? busy : label}
      </button>
      <Result state={state} pending={pending} />
    </form>
  );
}

export const CopyProductsButton = ({ disabled, first }: { disabled: boolean; first: boolean }) => (
  <RunButton
    run={copyProductsAction}
    label={first ? "Copy products to the relay store" : "Copy new and changed products"}
    busy="Copying… this can take a minute"
    tone={first ? "accent" : "glass"}
    disabled={disabled}
  />
);

export const SendWaitingButton = ({ disabled }: { disabled: boolean }) => (
  <RunButton run={sendWaitingAction} label="Send waiting orders now" busy="Sending…" disabled={disabled} />
);

export const CheckShippedButton = ({ disabled }: { disabled: boolean }) => (
  <RunButton run={checkShippedAction} label="Check for shipped orders now" busy="Checking…" disabled={disabled} />
);
