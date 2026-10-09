"use client";

import { useId } from "react";
import { type AuthFormState, createOwner, signIn } from "@/app/admin/(auth)/actions";
import { useFormAction } from "./use-form-action";

const initial: AuthFormState = {};

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input {...input} id={id} aria-describedby={hint ? hintId : undefined} className="input" />
      {hint ? (
        <p id={hintId} className="text-[0.8125rem] text-smoke">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  return (
    <p role="alert" aria-live="polite" className="min-h-6 text-sm text-accent">
      {message}
    </p>
  );
}

export function SignInForm() {
  const { state, action, pending, onSubmit } = useFormAction(signIn, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={state.values?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-accent w-full disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SetupForm({ code, minLength }: { code: string; minLength: number }) {
  const { state, action, pending, onSubmit } = useFormAction(createOwner, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="code" value={code} />
      <Field
        label="Your name"
        name="name"
        autoComplete="name"
        required
        defaultValue={state.values?.name}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={state.values?.email}
        hint="You'll sign in with this."
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
        hint={`At least ${minLength} characters. A few random words works well.`}
      />
      <Field
        label="Password again"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
      />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-accent w-full disabled:opacity-60">
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
