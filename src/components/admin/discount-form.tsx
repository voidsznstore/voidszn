"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type DiscountFormState,
  createDiscountAction,
  deleteDiscountAction,
  toggleDiscountAction,
  updateDiscountAction,
} from "@/app/admin/(panel)/discounts/actions";
import { type DiscountKind, discountSummary, normalizeCode } from "@/lib/discounts/describe";
import { ConfirmButton } from "./confirm-button";
import { useFormAction } from "./use-form-action";

export type DiscountFormValues = {
  id?: string;
  code: string;
  type: DiscountKind;
  /** Whole number, 1 to 100. */
  percent: string;
  /** Dollars, like "5" or "7.50". */
  amount: string;
  hasMinimum: boolean;
  minimum: string;
  hasLimit: boolean;
  maxUses: string;
  oncePerCustomer: boolean;
  firstOrderOnly: boolean;
  /** Date-and-time field values in the store's time zone. */
  startsAt: string;
  hasEnd: boolean;
  expiresAt: string;
  isActive: boolean;
  note: string;
};

export const BLANK_DISCOUNT: DiscountFormValues = {
  code: "",
  type: "PERCENTAGE",
  percent: "10",
  amount: "5",
  hasMinimum: false,
  minimum: "",
  hasLimit: false,
  maxUses: "",
  oncePerCustomer: false,
  firstOrderOnly: false,
  startsAt: "",
  hasEnd: false,
  expiresAt: "",
  isActive: true,
  note: "",
};

const initial: DiscountFormState = {};

// No 0, O, 1 or I, so a code read out loud can't be misheard.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function randomCode(): string {
  const picks = new Uint32Array(8);
  crypto.getRandomValues(picks);
  return Array.from(picks, (pick) => ALPHABET[pick % ALPHABET.length]).join("");
}

const wallTime = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
/** A date-and-time field's value in words: "Oct 31, 2026, 11:59 PM". */
function readable(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return local;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  return wallTime.format(new Date(Date.UTC(year, month - 1, day, hour, minute)));
}

const TYPES: { value: DiscountKind; label: string; hint: string }[] = [
  { value: "PERCENTAGE", label: "Percentage off", hint: "Takes a share off the items, like 20%." },
  { value: "FIXED", label: "Amount off", hint: "Takes a set amount off the items, like $5." },
  { value: "FREE_SHIPPING", label: "Free shipping", hint: "Shipping costs nothing. Item prices stay." },
];

/**
 * Every visit to the page starts from what is saved: an empty form for a new
 * code, the code's own details for an existing one.
 */
export function DiscountEditor(props: Props) {
  const { bfcacheId } = useRouter();
  return <DiscountForm key={bfcacheId} {...props} />;
}

type Props = {
  discount: DiscountFormValues;
  /** e.g. "Eastern Time", so the dates can't be misread. */
  timeZoneName: string;
};

function DiscountForm({ discount, timeZoneName }: Props) {
  const { state, action, pending, onSubmit } = useFormAction(
    discount.id ? updateDiscountAction : createDiscountAction,
    initial,
  );
  const [values, setValues] = useState(discount);
  const set = <Key extends keyof DiscountFormValues>(key: Key, value: DiscountFormValues[Key]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const label = "text-sm font-semibold";
  const small = "text-[0.8125rem] text-smoke";
  const section = "panel flex flex-col gap-4 p-5";
  const check = "h-5 w-5 flex-none accent-[var(--color-accent)]";

  // The same words customers see, built from what is typed so far.
  const percent = Number(values.percent);
  const dollars = Number(values.amount);
  const minimum = values.hasMinimum ? Math.round(Number(values.minimum) * 100) : 0;
  const summary = discountSummary({
    type: values.type,
    value: values.type === "PERCENTAGE" ? (percent > 0 ? percent : 0) : Math.round((dollars > 0 ? dollars : 0) * 100),
    minOrderCents: Number.isFinite(minimum) && minimum > 0 ? minimum : 0,
  });
  const facts = [
    summary,
    values.hasLimit && Number(values.maxUses) > 0
      ? `Can be used ${Number(values.maxUses).toLocaleString("en-US")} ${Number(values.maxUses) === 1 ? "time" : "times"} in total`
      : "No limit on total uses",
    values.firstOrderOnly
      ? "First order only"
      : values.oncePerCustomer
        ? "Once per customer"
        : "Customers can use it more than once",
    values.startsAt ? `Starts ${readable(values.startsAt)}` : "Works as soon as it is saved",
    values.hasEnd && values.expiresAt ? `Ends ${readable(values.expiresAt)}` : "No end date",
  ];

  return (
    <form action={action} onSubmit={onSubmit} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      {discount.id ? <input type="hidden" name="id" value={discount.id} /> : null}

      <div className="flex min-w-0 flex-col gap-6">
        <section className={section}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="discount-code" className={label}>
              Code
            </label>
            <div className="flex gap-2">
              <input
                id="discount-code"
                name="code"
                value={values.code}
                onChange={(event) => set("code", normalizeCode(event.target.value))}
                required
                maxLength={30}
                autoComplete="off"
                spellCheck={false}
                placeholder="WELCOME10"
                className="input min-w-0 flex-1 font-mono uppercase tracking-wider"
              />
              <button
                type="button"
                onClick={() => set("code", randomCode())}
                className="btn btn-glass btn-sm min-h-[2.875rem] flex-none"
              >
                Make one up
              </button>
            </div>
            <p className={small}>What customers type at checkout. Letters, numbers and dashes.</p>
          </div>
        </section>

        <section className={section}>
          <fieldset className="flex flex-col gap-3">
            <legend className={`${label} mb-3`}>What it gives</legend>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((option) => (
                <label key={option.value} className={`chip cursor-pointer ${values.type === option.value ? "is-on" : ""}`}>
                  <input
                    type="radio"
                    name="type"
                    value={option.value}
                    checked={values.type === option.value}
                    onChange={() => set("type", option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className={small}>{TYPES.find((option) => option.value === values.type)?.hint}</p>
          </fieldset>

          {values.type === "PERCENTAGE" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="discount-percent" className={label}>
                Percentage
              </label>
              <div className="relative w-40">
                <input
                  id="discount-percent"
                  name="percent"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  required
                  value={values.percent}
                  onChange={(event) => set("percent", event.target.value)}
                  className="input num pr-9"
                />
                <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-smoke">
                  %
                </span>
              </div>
            </div>
          ) : null}

          {values.type === "FIXED" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="discount-amount" className={label}>
                Amount
              </label>
              <div className="relative w-40">
                <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke">
                  $
                </span>
                <input
                  id="discount-amount"
                  name="amount"
                  inputMode="decimal"
                  required
                  value={values.amount}
                  onChange={(event) => set("amount", event.target.value)}
                  className="input num pl-8"
                />
              </div>
            </div>
          ) : null}
        </section>

        <section className={section}>
          <h2 className={label}>Who can use it</h2>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name="hasMinimum"
              checked={values.hasMinimum}
              onChange={(event) => set("hasMinimum", event.target.checked)}
              className={check}
            />
            <span>Only on orders over a certain amount</span>
          </label>
          {values.hasMinimum ? (
            <div className="flex flex-col gap-1.5 pl-8">
              <label htmlFor="discount-minimum" className={label}>
                Smallest order, before shipping
              </label>
              <div className="relative w-40">
                <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke">
                  $
                </span>
                <input
                  id="discount-minimum"
                  name="minimum"
                  inputMode="decimal"
                  required
                  value={values.minimum}
                  onChange={(event) => set("minimum", event.target.value)}
                  className="input num pl-8"
                />
              </div>
            </div>
          ) : null}

          <label className="flex min-h-11 items-center gap-3 border-t border-line pt-4">
            <input
              type="checkbox"
              name="hasLimit"
              checked={values.hasLimit}
              onChange={(event) => set("hasLimit", event.target.checked)}
              className={check}
            />
            <span>Limit how many times it can be used in total</span>
          </label>
          {values.hasLimit ? (
            <div className="flex flex-col gap-1.5 pl-8">
              <label htmlFor="discount-max-uses" className={label}>
                Number of uses
              </label>
              <input
                id="discount-max-uses"
                name="maxUses"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                value={values.maxUses}
                onChange={(event) => set("maxUses", event.target.value)}
                className="input num w-40"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1 border-t border-line pt-4">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                name="oncePerCustomer"
                checked={values.oncePerCustomer}
                onChange={(event) => set("oncePerCustomer", event.target.checked)}
                aria-describedby="discount-once-hint"
                className={check}
              />
              <span>One use per customer</span>
            </label>
            <p id="discount-once-hint" className={`${small} pl-8`}>
              Checked against the email given at checkout.
            </p>
          </div>

          <div className="flex flex-col gap-1 border-t border-line pt-4">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                name="firstOrderOnly"
                checked={values.firstOrderOnly}
                onChange={(event) => set("firstOrderOnly", event.target.checked)}
                aria-describedby="discount-first-hint"
                className={check}
              />
              <span>First order only</span>
            </label>
            <p id="discount-first-hint" className={`${small} pl-8`}>
              Only works for an email that has never ordered. For a welcome offer.
            </p>
          </div>
        </section>

        <section className={section}>
          <h2 className={label}>When it works</h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="discount-starts" className={label}>
              Starts
            </label>
            <input
              id="discount-starts"
              name="startsAt"
              type="datetime-local"
              value={values.startsAt}
              onChange={(event) => set("startsAt", event.target.value)}
              className="input w-full max-w-xs"
            />
            <p className={small}>Leave empty to start straight away. Times are {timeZoneName}.</p>
          </div>
          <label className="flex min-h-11 items-center gap-3 border-t border-line pt-4">
            <input
              type="checkbox"
              name="hasEnd"
              checked={values.hasEnd}
              onChange={(event) => set("hasEnd", event.target.checked)}
              className={check}
            />
            <span>Set an end date</span>
          </label>
          {values.hasEnd ? (
            <div className="flex flex-col gap-1.5 pl-8">
              <label htmlFor="discount-ends" className={label}>
                Ends
              </label>
              <input
                id="discount-ends"
                name="expiresAt"
                type="datetime-local"
                required
                value={values.expiresAt}
                onChange={(event) => set("expiresAt", event.target.value)}
                className="input w-full max-w-xs"
              />
            </div>
          ) : null}
        </section>

        <section className={section}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="discount-note" className={label}>
              Note to self (optional)
            </label>
            <input
              id="discount-note"
              name="note"
              maxLength={300}
              value={values.note}
              onChange={(event) => set("note", event.target.value)}
              placeholder="What it's for. Customers never see this."
              className="input"
            />
          </div>
        </section>
      </div>

      <aside className="panel flex flex-col gap-4 p-5 xl:sticky xl:top-8">
        <div className="flex flex-col gap-2">
          <p className="label text-smoke">Summary</p>
          <p className="break-all font-mono text-2xl font-semibold tracking-wider text-white">
            {values.code || "No code yet"}
          </p>
        </div>
        <ul className="list-disc space-y-1.5 pl-5 text-[0.9375rem] text-bone-dim marker:text-accent">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>

        <label className="flex min-h-11 items-center gap-3 border-t border-line pt-4">
          <input
            type="checkbox"
            name="isActive"
            checked={values.isActive}
            onChange={(event) => set("isActive", event.target.checked)}
            className={check}
          />
          <span>Turned on</span>
        </label>

        <button type="submit" disabled={pending} className="btn btn-accent w-full">
          {pending ? "Saving…" : discount.id ? "Save changes" : "Create code"}
        </button>
        <p role="alert" aria-live="polite" className={`min-h-5 text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? (state.saved && !pending ? "Saved." : "")}
        </p>
      </aside>
    </form>
  );
}

/** The on/off switch shown on each row of the list. */
export function DiscountSwitch({ id, code, isActive }: { id: string; code: string; isActive: boolean }) {
  const { action, pending, onSubmit } = useFormAction(toggleDiscountAction, initial);
  return (
    <form action={action} onSubmit={onSubmit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="turn" value={isActive ? "off" : "on"} />
      <button
        type="submit"
        role="switch"
        aria-checked={isActive}
        aria-label={`Code ${code}`}
        disabled={pending}
        className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition-colors disabled:opacity-60 ${
          isActive ? "border-white/25 bg-accent shadow-[0_0_16px_-4px_var(--glow)]" : "border-line-strong bg-white/[0.06]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-5 w-5 rounded-full bg-bone shadow transition-transform ${isActive ? "translate-x-[1.375rem]" : "translate-x-1"}`}
        />
      </button>
    </form>
  );
}

export function DeleteDiscountForm({ id }: { id: string }) {
  const { state, action, onSubmit } = useFormAction(deleteDiscountAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton label="Delete this code" confirmLabel="Delete code" />
      <p role="alert" className="text-sm text-ember">
        {state.error}
      </p>
    </form>
  );
}
