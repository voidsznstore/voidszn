"use client";

import { useRouter } from "next/navigation";
import {
  type CustomerFormState,
  createCustomerAction,
  deleteCustomerAction,
  updateCustomerAction,
} from "@/app/admin/(panel)/customers/actions";
import { ConfirmButton } from "./confirm-button";
import { useFormAction } from "./use-form-action";

export type CustomerFormValues = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  acceptsEmail: boolean;
  notes: string;
};

type Props = {
  customer: CustomerFormValues;
  /** e.g. "Oct 9, 2026", when they unsubscribed themselves. */
  unsubscribedOn?: string | null;
};

const initial: CustomerFormState = {};

/** A new customer starts from an empty form every time the page is opened. */
export function NewCustomerForm(props: Props) {
  const { bfcacheId } = useRouter();
  return <CustomerForm key={bfcacheId} {...props} />;
}

export function CustomerForm({ customer, unsubscribedOn }: Props) {
  const { state, action, pending, onSubmit } = useFormAction(
    customer.id ? updateCustomerAction : createCustomerAction,
    initial,
  );
  const labelClass = "text-sm font-semibold";
  const small = "text-[0.8125rem] text-smoke";

  const field = (
    name: keyof CustomerFormValues,
    label: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`customer-${name}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`customer-${name}`}
        name={name}
        defaultValue={String(customer[name] ?? "")}
        autoComplete="off"
        className="input"
        {...extra}
      />
    </div>
  );

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      {customer.id ? <input type="hidden" name="id" value={customer.id} /> : null}
      {/* Says this form was showing the unsubscribe, so ticking the box below is deliberate. */}
      {unsubscribedOn ? <input type="hidden" name="knewOptOut" value="1" /> : null}
      {field("name", "Name", { maxLength: 120 })}
      {field("email", "Email", { type: "email", required: true, maxLength: 254 })}
      {field("phone", "Phone (optional)", { type: "tel", maxLength: 40 })}

      <fieldset className="flex flex-col gap-4 border-t border-line pt-4">
        <legend className="sr-only">Address</legend>
        {field("line1", "Street address (optional)", { maxLength: 200 })}
        {field("line2", "Apartment, suite", { maxLength: 200 })}
        {field("city", "City", { maxLength: 100 })}
        <div className="grid grid-cols-2 gap-3">
          {field("state", "State", { maxLength: 60 })}
          {field("postalCode", "ZIP code", { maxLength: 20 })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1 border-t border-line pt-4">
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="acceptsEmail"
            defaultChecked={customer.acceptsEmail}
            aria-describedby="customer-consent-hint"
            className="h-5 w-5 flex-none accent-[var(--color-accent)]"
          />
          <span>Agreed to get marketing emails</span>
        </label>
        <p id="customer-consent-hint" className={small}>
          {unsubscribedOn
            ? `They unsubscribed on ${unsubscribedOn}. Only tick this again if they asked to get emails again.`
            : "Only tick this if they said yes. Order emails go out either way."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-4">
        <label htmlFor="customer-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="customer-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={customer.notes}
          placeholder="Sizes they like, how you know them. Customers never see this."
          className="input"
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent disabled:opacity-60">
          {pending ? "Saving…" : customer.id ? "Save" : "Add customer"}
        </button>
        <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-accent" : "text-smoke"}`}>
          {state.error ?? (state.saved && !pending ? `Saved. ${state.note ?? ""}`.trim() : "")}
        </p>
      </div>
    </form>
  );
}

/** Shown only for a customer with no orders. */
export function DeleteCustomerForm({ id }: { id: string }) {
  const { state, action, onSubmit } = useFormAction(deleteCustomerAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton label="Delete this customer" confirmLabel="Delete customer" />
      <p role="alert" className="text-sm text-accent">
        {state.error}
      </p>
    </form>
  );
}
