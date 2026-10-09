"use client";

import { useEffect, useRef } from "react";
import {
  type CategoryFormState,
  createCategoryAction,
  updateCategoryAction,
} from "@/app/admin/(panel)/categories/actions";
import { useFormAction } from "./use-form-action";

const initial: CategoryFormState = {};

export function NewCategoryForm({ kind, label }: { kind: "PRODUCT_TYPE" | "INTEREST"; label: string }) {
  const { state, action, pending, onSubmit } = useFormAction(createCategoryAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the box once the category has been added.
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          maxLength={60}
          aria-label={label}
          placeholder={label}
          className="input min-w-0 flex-1"
        />
        <button type="submit" disabled={pending} className="btn btn-outline min-h-[2.875rem] px-5 disabled:opacity-60">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <p role="alert" className="min-h-5 text-sm text-accent">
        {state.error}
      </p>
    </form>
  );
}

export function EditCategoryForm({
  category,
}: {
  category: { id: string; name: string; description: string; isActive: boolean };
}) {
  const { state, action, pending, onSubmit } = useFormAction(updateCategoryAction, initial);

  return (
    <form action={action} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-5">
      <input type="hidden" name="id" value={category.id} />
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Name</span>
        <input name="name" required maxLength={60} defaultValue={category.name} className="input" />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Description</span>
        <textarea
          name="description"
          rows={2}
          maxLength={300}
          defaultValue={category.description}
          className="input"
        />
        <span className="text-[0.8125rem] text-smoke">Shown under the title on the category page.</span>
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="isActive" defaultChecked={category.isActive} className="h-5 w-5 accent-[var(--color-accent)]" />
        <span>Show this category on the store</span>
      </label>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <p aria-live="polite" className={`text-sm ${state.error ? "text-accent" : "text-smoke"}`}>
          {state.error ?? (state.saved && !pending ? "Saved." : "")}
        </p>
      </div>
    </form>
  );
}
