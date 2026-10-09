"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  type CodeFormState,
  type EnrolFormState,
  confirmAuthenticator,
  verifySecondStep,
} from "@/app/admin/(auth)/actions";
import {
  type SecurityFormState,
  newRecoveryCodesAction,
  replaceAuthenticatorAction,
} from "@/app/admin/(panel)/security/actions";
import { useFormAction } from "./use-form-action";

function CodeField({ label, hint, wide = false }: { label: string; hint?: string; wide?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        name="code"
        required
        autoComplete="one-time-code"
        inputMode={wide ? "text" : "numeric"}
        maxLength={wide ? 20 : 7}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="input font-mono text-lg tracking-[0.2em]"
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-smoke">
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

/** The recovery codes, shown once, with a way to copy them. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4 notice p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Save your recovery codes</h2>
        <p className="text-sm text-bone-dim">
          If you lose your phone, one of these gets you in instead of the app. Each works once.
          They won&apos;t be shown again, so save them somewhere safe now.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm text-white">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join("\n"));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="btn btn-glass min-h-11 px-5"
        >
          Copy codes
        </button>
        <p aria-live="polite" className="text-sm text-smoke">
          {copied ? "Copied." : ""}
        </p>
      </div>
    </div>
  );
}

/** Second step of signing in. */
export function VerifyForm() {
  const { state, action, pending, onSubmit } = useFormAction<CodeFormState>(verifySecondStep, {});
  const [useRecovery, setUseRecovery] = useState(false);

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      {useRecovery ? (
        <CodeField key="recovery" label="Recovery code" hint="One of the codes you saved when you set this up." wide />
      ) : (
        <CodeField key="app" label="Six-digit code" hint="From the VOIDSZN entry in your authenticator app." />
      )}
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Checking…" : "Sign in"}
      </button>
      <button
        type="button"
        onClick={() => setUseRecovery(!useRecovery)}
        className="inline-flex min-h-11 items-center justify-center text-sm text-smoke link"
      >
        {useRecovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
    </form>
  );
}

/** Last step of setting the app up: enter a code to prove the scan worked. */
export function EnrolForm() {
  const { state, action, pending, onSubmit } = useFormAction<EnrolFormState>(confirmAuthenticator, {});

  if (state.recoveryCodes) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-center text-bone-dim">
          Your authenticator app is set up. From now on, signing in asks for a code from it.
        </p>
        <RecoveryCodes codes={state.recoveryCodes} />
        <Link href="/admin" className="btn btn-accent w-full">
          I&apos;ve saved them. Go to the admin
        </Link>
      </div>
    );
  }

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <CodeField label="Six-digit code from the app" />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Checking…" : "Turn on two-step sign-in"}
      </button>
    </form>
  );
}

/** Two actions on the security screen that each need a fresh code. */
export function SecurityCodeForm({ kind }: { kind: "recovery-codes" | "replace-app" }) {
  const serverAction = kind === "recovery-codes" ? newRecoveryCodesAction : replaceAuthenticatorAction;
  const { state, action, pending, onSubmit } = useFormAction<SecurityFormState>(serverAction, {});

  if (state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} />;

  return (
    <form action={action} onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
      <CodeField label="Current six-digit code" hint="From your authenticator app, to confirm it's you." wide />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-glass min-h-11 px-5">
        {pending
          ? "Checking…"
          : kind === "recovery-codes"
            ? "Make new recovery codes"
            : "Set up a different app or phone"}
      </button>
    </form>
  );
}
