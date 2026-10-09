"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type AutomationFormState,
  saveAutomationAction,
  sendSampleAction,
} from "@/app/admin/(panel)/campaigns/automatic/actions";
import { EmailPreview } from "./email-preview";
import { useFormAction } from "./use-form-action";

type CodeOption = { id: string; label: string };

export type AutomationValues = {
  enabled: boolean;
  steps: { hours: number; discountCodeId: string | null }[];
  deliveredCodeId: string | null;
};

const initial: AutomationFormState = {};

const STEPS = [
  { name: "First reminder", hint: "A short nudge. Works without a code.", preview: "cart-1" },
  { name: "Second reminder", hint: "Free shipping is a gentle push here.", preview: "cart-2" },
  { name: "Last reminder", hint: "If you offer money off anywhere, offer it here.", preview: "cart-3" },
];

function CodeSelect({
  name,
  id,
  value,
  codes,
}: {
  name: string;
  id: string;
  value: string | null;
  codes: CodeOption[];
}) {
  // A code that was picked earlier but can't be used any more still shows, marked as such.
  const missing = value && !codes.some((code) => code.id === value);
  return (
    <select id={id} name={name} defaultValue={value ?? ""} className="input">
      <option value="">No code</option>
      {missing ? <option value={value}>A code that can&apos;t be used any more</option> : null}
      {codes.map((code) => (
        <option key={code.id} value={code.id}>
          {code.label}
        </option>
      ))}
    </select>
  );
}

type FormProps = { values: AutomationValues; codes: CodeOption[] };

/** Each visit to the page starts from what is saved, not from what was last typed. */
export function AutomationForm(props: FormProps) {
  const { bfcacheId } = useRouter();
  return <Settings key={bfcacheId} {...props} />;
}

/** Settings for the emails the store sends by itself. One form, one save. */
function Settings({ values, codes }: FormProps) {
  const { state, action, pending, onSubmit } = useFormAction(saveAutomationAction, initial);
  const [enabled, setEnabled] = useState(values.enabled);
  const label = "text-sm font-semibold";
  const small = "text-[0.8125rem] text-smoke";

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="panel flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-2xl flex-col gap-1">
            <h2 className="text-lg font-semibold text-white">Cart reminders</h2>
            <p className="text-bone-dim">
              When someone gives their email at checkout and leaves without paying, the store
              emails them their cart. It stops the moment they order or unsubscribe.
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <span className={label}>{enabled ? "On" : "Off"}</span>
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bone ${
                enabled ? "border-white/25 bg-accent shadow-[0_0_16px_-4px_var(--glow)]" : "border-line-strong bg-white/[0.06]"
              }`}
            >
              <span className={`h-5 w-5 rounded-full bg-bone shadow transition-transform ${enabled ? "translate-x-[1.375rem]" : "translate-x-1"}`} />
            </span>
          </label>
        </div>

        <ol className={`flex flex-col ${enabled ? "" : "opacity-50"}`}>
          {STEPS.map((step, index) => (
            <li
              key={step.name}
              className="grid items-end gap-x-4 gap-y-3 border-t border-line py-4 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,16rem)_auto]"
            >
              <div className="flex flex-col gap-0.5 self-center">
                <span className="font-semibold text-white">{step.name}</span>
                <span className={small}>{step.hint}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`hours-${index}`} className={label}>
                  Hours after
                </label>
                <input
                  id={`hours-${index}`}
                  name={`hours${index + 1}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={168}
                  step={1}
                  required
                  defaultValue={values.steps[index].hours}
                  className="input num"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`code-${index}`} className={label}>
                  Code to offer
                </label>
                <CodeSelect
                  id={`code-${index}`}
                  name={`code${index + 1}`}
                  value={values.steps[index].discountCodeId}
                  codes={codes}
                />
              </div>
              <Link href={`/admin/campaigns/automatic/${step.preview}`} className="link inline-flex min-h-[2.875rem] items-center text-sm">
                Preview
              </Link>
            </li>
          ))}
        </ol>
        <p className={small}>
          Counted from when they left checkout. Reminders go out within half an hour of
          the time set.{" "}
          {codes.length === 0 ? (
            <>
              To offer a code,{" "}
              <Link href="/admin/discounts/new" className="link">
                create one
              </Link>{" "}
              first.
            </>
          ) : null}
        </p>
      </section>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="text-lg font-semibold text-white">Thank-you code</h2>
          <p className="text-bone-dim">
            Put a code in the email that says an order was delivered, for money off the next one.
          </p>
        </div>
        <div className="flex max-w-sm flex-col gap-1.5">
          <label htmlFor="delivered-code" className={label}>
            Code to offer
          </label>
          <CodeSelect id="delivered-code" name="delivered" value={values.deliveredCodeId} codes={codes} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Saving…" : "Save settings"}
        </button>
        <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? (state.saved && !pending ? "Saved." : "")}
        </p>
      </div>
    </form>
  );
}

/** An automatic email shown at phone or desktop width, with a button to send yourself a copy. */
export function SamplePreview({
  emailKey,
  html,
  title,
  testAddress,
  canSend,
}: {
  emailKey: string;
  html: string;
  title: string;
  testAddress: string;
  canSend: boolean;
}) {
  const [width, setWidth] = useState<"phone" | "desktop">("phone");
  const { state, action, pending, onSubmit } = useFormAction(sendSampleAction, initial);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(["phone", "desktop"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={width === option}
              onClick={() => setWidth(option)}
              className="chip min-h-9 px-4 capitalize"
            >
              {option}
            </button>
          ))}
        </div>
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="key" value={emailKey} />
          <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
            {state.error ?? (pending ? "" : (state.done ?? (canSend ? `Tests go to ${testAddress}.` : "")))}
          </p>
          <button type="submit" disabled={pending || !canSend} className="btn btn-glass btn-sm">
            {pending ? "Sending…" : "Send a test to me"}
          </button>
        </form>
      </div>
      <EmailPreview html={html} title={title} narrow={width === "phone"} />
    </div>
  );
}
