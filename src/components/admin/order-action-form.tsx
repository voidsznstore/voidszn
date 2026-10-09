"use client";

import { type ReactNode, useEffect, useRef } from "react";
import type { OrderActionState } from "@/app/admin/(panel)/orders/actions";
import { useFormAction } from "./use-form-action";

type OrderActionFormProps = {
  action: (previous: OrderActionState, form: FormData) => Promise<OrderActionState>;
  orderNumber: string;
  submitLabel: string;
  pendingLabel?: string;
  /** "accent" for the main next step, "outline" for everything else. */
  tone?: "accent" | "outline";
  /** Clear the fields after a successful save (for notes). */
  resetOnDone?: boolean;
  children?: ReactNode;
};

/** A small form for one change to an order. Shows what happened underneath. */
export function OrderActionForm({
  action,
  orderNumber,
  submitLabel,
  pendingLabel = "Saving…",
  tone = "outline",
  resetOnDone = false,
  children,
}: OrderActionFormProps) {
  const { state, action: formAction, pending, onSubmit } = useFormAction(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.done && resetOnDone) formRef.current?.reset();
  }, [state, resetOnDone]);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="orderNumber" value={orderNumber} />
      {children}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className={`btn min-h-11 px-5 ${tone === "accent" ? "btn-accent" : "btn-glass"}`}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        <p aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? (pending ? "" : state.done)}
        </p>
      </div>
    </form>
  );
}
