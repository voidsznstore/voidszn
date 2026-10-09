"use client";

import Link from "next/link";
import { useId } from "react";
import {
  type AuthFormState,
  type ResetRequestState,
  chooseNewPassword,
  createOwner,
  joinTeam,
  requestReset,
  signIn,
} from "@/app/admin/(auth)/actions";
import {
  type NameFormState,
  type PasswordFormState,
  changePasswordAction,
  renameAction,
} from "@/app/admin/(panel)/security/actions";
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
    <p role="alert" aria-live="polite" className="min-h-6 text-sm text-ember">
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
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <Link
        href="/admin/forgot"
        className="inline-flex min-h-11 items-center justify-center text-sm text-smoke link"
      >
        Forgot your password?
      </Link>
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
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}

/** Accepting an invitation to the admin: a name and a password. The email is fixed by the invitation. */
export function JoinForm({
  code,
  name,
  email,
  minLength,
}: {
  code: string;
  name: string;
  email: string;
  minLength: number;
}) {
  const { state, action, pending, onSubmit } = useFormAction(joinTeam, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="code" value={code} />
      <Field
        label="Your name"
        name="name"
        autoComplete="name"
        required
        defaultValue={state.values?.name ?? name}
        hint="Shown on your dashboard and next to anything you change."
      />
      <Field label="Email" type="email" value={email} readOnly autoComplete="username" hint="You'll sign in with this." />
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
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Setting up your account…" : "Join the team"}
      </button>
    </form>
  );
}

/** "Forgot my password": asks for the account's email. */
export function ForgotForm() {
  const { state, action, pending, onSubmit } = useFormAction<ResetRequestState>(requestReset, {});

  if (state.sent) {
    return (
      <p className="panel px-4 py-4 text-center text-bone-dim">
        If that email has an admin account, a reset link is on its way. It works for an hour.
        Check your spam folder if you don&apos;t see it.
      </p>
    );
  }

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label="Email" name="email" type="email" autoComplete="username" required />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}

/** Choosing a new password after following a reset link. */
export function NewPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const { state, action, pending, onSubmit } = useFormAction(chooseNewPassword, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
        hint={`At least ${minLength} characters.`}
      />
      <Field
        label="New password again"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
      />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

/** Changing the password from the Security screen. */
export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const { state, action, pending, onSubmit } = useFormAction<PasswordFormState>(
    changePasswordAction,
    {},
  );
  return (
    // The key clears the boxes once the password has been changed.
    <form
      key={state.done ? "done" : "editing"}
      action={action}
      onSubmit={onSubmit}
      className="flex max-w-sm flex-col gap-4"
    >
      <Field label="Current password" name="current" type="password" autoComplete="current-password" required />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
        hint={`At least ${minLength} characters.`}
      />
      <Field label="New password again" name="confirm" type="password" autoComplete="new-password" minLength={minLength} required />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-glass min-h-11 px-5">
          {pending ? "Saving…" : "Change password"}
        </button>
        <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? (state.done ? "Password changed. Other browsers were signed out." : "")}
        </p>
      </div>
    </form>
  );
}

/** Changing the name shown on your dashboard. */
export function NameForm({ name }: { name: string }) {
  const { state, action, pending, onSubmit } = useFormAction<NameFormState>(renameAction, {});
  return (
    <form action={action} onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
      <Field label="Your name" name="name" autoComplete="name" required maxLength={100} defaultValue={name} />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-glass">
          {pending ? "Saving…" : "Save name"}
        </button>
        <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? (state.done && !pending ? "Saved." : "")}
        </p>
      </div>
    </form>
  );
}
