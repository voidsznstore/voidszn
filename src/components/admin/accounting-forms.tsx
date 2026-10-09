"use client";

import { useRouter } from "next/navigation";
import {
  type MoneyFormState,
  addExpenseAction,
  addRecurringAction,
  collectTaxAction,
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
        {/* Card payout fees are worked out from the payouts themselves, so they are never typed in. */}
        {Object.entries(EXPENSE_CATEGORIES)
          .filter(([key]) => key !== "PAYOUTS")
          .map(([key, label]) => (
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

/** The switch for charging Florida sales tax at checkout. Only the master account can flip it. */
export function CollectTaxSwitch({ on, canChange }: { on: boolean; canChange: boolean }) {
  const { state, action, pending, onSubmit } = useFormAction(collectTaxAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="well flex flex-col gap-2 p-4">
      <input type="hidden" name="turn" value={on ? "off" : "on"} />
      <div className="flex items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-white">Charge sales tax at checkout</span>
          <span className="text-[0.8125rem] text-smoke">
            On: an order delivered in Florida pays 6% plus its county&apos;s surtax (6.5% in Orlando), on top of
            the price. Orders to other states pay none. Off: nobody is charged, and the tax on Florida orders
            comes out of the price instead.
            {canChange ? "" : " Only the master account can change this."}
          </span>
        </span>
        <button
          type="submit"
          role="switch"
          aria-checked={on}
          aria-label="Charge sales tax at checkout"
          disabled={pending || !canChange}
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
      {pending || !(state.error ?? state.done) ? null : <Result state={state} />}
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
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={field}>
          Card payout fee (%)
          <input name="payoutPercent" inputMode="decimal" required defaultValue={(value.payoutFeeBps / 100).toString()} className="input" />
        </label>
        <label className={field}>
          Card payout fee, fixed part (USD)
          <input name="payoutFixed" inputMode="decimal" required defaultValue={(value.payoutFeeFixedCents / 100).toFixed(2)} className="input" />
        </label>
        <label className={field}>
          Per partner paid by card, a month (USD)
          <input name="payoutAccount" inputMode="decimal" required defaultValue={(value.payoutAccountCents / 100).toFixed(2)} className="input" />
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
