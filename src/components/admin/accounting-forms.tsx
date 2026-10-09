"use client";

import { useRouter } from "next/navigation";
import {
  type MoneyFormState,
  addExpenseAction,
  addRecurringAction,
  saveAssumptionsAction,
} from "@/app/admin/(panel)/accounting/actions";
import { EXPENSE_CATEGORIES } from "@/lib/accounting/categories";
import type { Assumptions } from "@/lib/accounting/ledger";
import { useFormAction } from "./use-form-action";

const initial: MoneyFormState = {};
const field = "flex flex-col gap-2 text-sm font-semibold";

function Result({ state }: { state: MoneyFormState }) {
  return (
    <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
      {state.error ?? state.done ?? ""}
    </p>
  );
}

function CategorySelect({ fallback }: { fallback: keyof typeof EXPENSE_CATEGORIES }) {
  return (
    <label className={field}>
      Kind
      <select name="category" defaultValue={fallback} className="input">
        {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Each visit to the page starts with empty boxes. */
export function ExpenseForm({ today }: { today: string }) {
  const { bfcacheId } = useRouter();
  return <Expense key={bfcacheId} today={today} />;
}

function Expense({ today }: { today: string }) {
  const { state, action, pending, onSubmit } = useFormAction(addExpenseAction, initial);
  return (
    // A new key after each success empties the boxes for the next one.
    <form key={state.at ?? 0} action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className={field}>
          Day
          <input name="spentOn" type="date" required defaultValue={today} max={today} className="input" />
        </label>
        <CategorySelect fallback="ADS" />
        <label className={field}>
          Amount (USD)
          <input name="amount" inputMode="decimal" required placeholder="25.00" autoComplete="off" className="input" />
        </label>
        <label className={field}>
          What it was for
          <input name="description" required maxLength={200} placeholder="Instagram ads" autoComplete="off" className="input" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Adding…" : "Add expense"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function RecurringForm({ today }: { today: string }) {
  const { bfcacheId } = useRouter();
  return <Recurring key={bfcacheId} today={today} />;
}

function Recurring({ today }: { today: string }) {
  const { state, action, pending, onSubmit } = useFormAction(addRecurringAction, initial);
  return (
    <form key={state.at ?? 0} action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <label className={field}>
          Name
          <input name="name" required maxLength={100} placeholder="Vercel" autoComplete="off" className="input" />
        </label>
        <CategorySelect fallback="SUBSCRIPTIONS" />
        <label className={field}>
          Amount (USD)
          <input name="amount" inputMode="decimal" required placeholder="20.00" autoComplete="off" className="input" />
        </label>
        <label className={field}>
          How often
          <select name="every" defaultValue="MONTH" className="input">
            <option value="MONTH">Every month</option>
            <option value="YEAR">Every year</option>
          </select>
        </label>
        <label className={field}>
          First charge
          <input name="startsOn" type="date" required defaultValue={today} className="input" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Adding…" : "Add subscription"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function AssumptionsForm({ value }: { value: Assumptions }) {
  const { bfcacheId } = useRouter();
  return <AssumptionsFields key={bfcacheId} value={value} />;
}

function AssumptionsFields({ value }: { value: Assumptions }) {
  const { state, action, pending, onSubmit } = useFormAction(saveAssumptionsAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={field}>
          Card fee (%)
          <input name="feePercent" inputMode="decimal" required defaultValue={(value.feeBps / 100).toString()} className="input" />
        </label>
        <label className={field}>
          Card fee, fixed part (USD)
          <input name="feeFixed" inputMode="decimal" required defaultValue={(value.feeFixedCents / 100).toFixed(2)} className="input" />
        </label>
        <label className={field}>
          Printer&apos;s shipping per order (USD)
          <input name="shipCost" inputMode="decimal" defaultValue={(value.shipCostCents / 100).toFixed(2)} className="input" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-glass">
          {pending ? "Saving…" : "Save"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
