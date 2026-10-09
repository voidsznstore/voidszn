"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type PayoutFormState,
  adjustAction,
  cancelPayoutAction,
  cashOutAction,
  markSentAction,
  saveHandleAction,
  saveTaxRateAction,
  setShareAction,
} from "@/app/admin/(panel)/payouts/actions";
import { useFormAction } from "./use-form-action";

const initial: PayoutFormState = {};
const field = "flex flex-col gap-2 text-sm font-semibold";

function Result({ state }: { state: PayoutFormState }) {
  return (
    <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
      {state.error ?? state.done ?? ""}
    </p>
  );
}

/** Cashing out asks once before it goes ahead. */
export function CashOutButton({ amount, disabled }: { amount: string; disabled: boolean }) {
  const { state, action, pending, onSubmit } = useFormAction(cashOutAction, initial);
  const [asking, setAsking] = useState(false);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        setAsking(false);
        onSubmit(event);
      }}
      className="flex flex-col gap-3"
    >
      {/* The keys keep these as two separate buttons. Without them the first button
          would turn into the second mid-click and send the form without asking. */}
      {asking ? (
        <div key="confirm" className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn btn-accent">
            Yes, cash out {amount}
          </button>
          <button type="button" onClick={() => setAsking(false)} className="inline-flex min-h-11 items-center text-sm link">
            Not now
          </button>
        </div>
      ) : (
        <div key="ask">
          <button type="button" disabled={disabled || pending} onClick={() => setAsking(true)} className="btn btn-accent">
            {pending ? "Cashing out…" : "Cash out"}
          </button>
        </div>
      )}
      <Result state={state} />
    </form>
  );
}

export function HandleForm({ handle }: { handle: string }) {
  const { bfcacheId } = useRouter();
  return <Handle key={bfcacheId} handle={handle} />;
}

function Handle({ handle }: { handle: string }) {
  const { state, action, pending, onSubmit } = useFormAction(saveHandleAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className={field}>
        Where to send it for now
        <input
          name="handle"
          defaultValue={handle}
          maxLength={80}
          placeholder="Zelle 407-555-0100"
          autoComplete="off"
          aria-describedby="handle-hint"
          className="input"
        />
      </label>
      <p id="handle-hint" className="text-[0.8125rem] font-normal text-smoke">
        A Zelle phone or email, or a Cash App or Venmo name. Never a card or account number.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-glass">
          {pending ? "Saving…" : "Save"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function TaxRateForm({ rate, rates }: { rate: number; rates: { bps: number; label: string }[] }) {
  const { state, action, pending, onSubmit } = useFormAction(saveTaxRateAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className={field}>
        Your income tax rate
        <select name="rate" defaultValue={rate} className="input">
          {rates.map((option) => (
            <option key={option.bps} value={option.bps}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="btn btn-glass">
        {pending ? "Saving…" : "Save"}
      </button>
      <Result state={state} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Master account                                                      */
/* ------------------------------------------------------------------ */

/** A cash-out waiting to be sent: mark it sent, or call it off. */
export function SettlePayoutForm({ id, summary }: { id: string; summary: string }) {
  const sent = useFormAction(markSentAction, initial);
  const cancelled = useFormAction(cancelPayoutAction, initial);
  const [note, setNote] = useState("");
  const pending = sent.pending || cancelled.pending;

  return (
    <div className="flex flex-col gap-3">
      <label className={field}>
        Note (optional)
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          placeholder="Sent by Zelle"
          autoComplete="off"
          className="input"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <form
          action={sent.action}
          onSubmit={(event) => {
            // It can't be undone, and they are emailed that the money has gone.
            if (!window.confirm(`Mark ${summary} as sent? They are emailed that it has gone, and it can't be undone.`)) {
              event.preventDefault();
              return;
            }
            sent.onSubmit(event);
          }}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="note" value={note} />
          <button type="submit" disabled={pending} className="btn btn-accent btn-sm">
            {sent.pending ? "Saving…" : "Mark as sent"}
          </button>
        </form>
        <form
          action={cancelled.action}
          onSubmit={(event) => {
            if (!window.confirm("Cancel this cash-out? The money goes back on their balance.")) {
              event.preventDefault();
              return;
            }
            cancelled.onSubmit(event);
          }}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="note" value={note} />
          <button type="submit" disabled={pending} className="btn btn-glass btn-sm">
            {cancelled.pending ? "Cancelling…" : "Cancel it"}
          </button>
        </form>
        <Result state={sent.state.error || sent.state.done ? sent.state : cancelled.state} />
      </div>
    </div>
  );
}

export function ShareForm({ adminId, percent }: { adminId: string; percent: string }) {
  const { bfcacheId } = useRouter();
  return <Share key={`${bfcacheId}-${percent}`} adminId={adminId} percent={percent} />;
}

function Share({ adminId, percent }: { adminId: string; percent: string }) {
  const { state, action, pending, onSubmit } = useFormAction(setShareAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="adminId" value={adminId} />
      <label className={field}>
        Share of the profit (%)
        <input name="percent" inputMode="decimal" required defaultValue={percent} autoComplete="off" className="input w-36" />
      </label>
      <button type="submit" disabled={pending} className="btn btn-glass">
        {pending ? "Saving…" : "Change share"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function AdjustForm({ adminId }: { adminId: string }) {
  const { bfcacheId } = useRouter();
  return <Adjust key={bfcacheId} adminId={adminId} />;
}

function Adjust({ adminId }: { adminId: string }) {
  const { state, action, pending, onSubmit } = useFormAction(adjustAction, initial);
  return (
    <form key={state.at ?? 0} action={action} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="adminId" value={adminId} />
      <div className="grid gap-3 sm:grid-cols-[10rem_9rem_1fr]">
        <label className={field}>
          Change
          <select name="direction" defaultValue="add" className="input">
            <option value="add">Add</option>
            <option value="take">Take off</option>
          </select>
        </label>
        <label className={field}>
          Amount (USD)
          <input name="amount" inputMode="decimal" required placeholder="50.00" autoComplete="off" className="input" />
        </label>
        <label className={field}>
          What for
          <input name="reason" required maxLength={200} placeholder="Paid for samples out of pocket" autoComplete="off" className="input" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-glass">
          {pending ? "Saving…" : "Change their balance"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
