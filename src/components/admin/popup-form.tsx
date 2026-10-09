"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  type PopupFormState,
  createPopupAction,
  deletePopupAction,
  movePopupAction,
  togglePopupAction,
  updatePopupAction,
} from "@/app/admin/(panel)/popups/actions";
import { PopupCard } from "@/components/site/popup-card";
import {
  POPUP_KINDS,
  POPUP_LIMITS,
  POPUP_PAGES,
  POPUP_TRIGGERS,
  type PopupContent,
  type PopupPages,
  type PopupTrigger,
} from "@/lib/popups/shape";
import { ConfirmButton } from "./confirm-button";
import { useFormAction } from "./use-form-action";

const initial: PopupFormState = {};

/** A discount code as the picker shows it. */
export type PopupCode = { id: string; code: string; summary: string; firstOrderOnly: boolean };

type Props = {
  /** Set for a pop-up that already exists. */
  id?: string;
  popup: PopupContent;
  codes: PopupCode[];
};

/** Every visit to the page starts from what is saved, not from what was last typed. */
export function PopupEditor(props: Props) {
  const { bfcacheId } = useRouter();
  return <Editor key={bfcacheId} {...props} />;
}

function Editor({ id, popup, codes }: Props) {
  const { state, action, pending, onSubmit } = useFormAction(id ? updatePopupAction : createPopupAction, initial);
  const [values, setValues] = useState(popup);
  // Numbers are kept as typed, so a field can be emptied while it is being changed.
  const [delay, setDelay] = useState(String(popup.delaySeconds));
  const [again, setAgain] = useState(String(popup.showAgainDays));
  const set = <Key extends keyof PopupContent>(key: Key, value: PopupContent[Key]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const previewId = useId();

  const label = "text-sm font-semibold";
  const small = "text-[0.8125rem] text-smoke";
  const section = "panel flex flex-col gap-4 p-5";
  const field = "flex flex-col gap-1.5";
  const check = "h-5 w-5 flex-none accent-[var(--color-accent)]";
  const { kind } = values;
  const picked = codes.find((code) => code.id === values.discountCodeId) ?? null;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <form action={action} onSubmit={onSubmit} className="flex min-w-0 flex-col gap-6">
        {id ? <input type="hidden" name="id" value={id} /> : null}
        <input type="hidden" name="kind" value={kind} />

        <section className={section}>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="text-lg font-semibold text-white">Show this pop-up</span>
              <span className={small}>{POPUP_KINDS[kind].about}</span>
            </span>
            <input
              type="checkbox"
              name="isEnabled"
              checked={values.isEnabled}
              onChange={(event) => set("isEnabled", event.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bone ${
                values.isEnabled
                  ? "border-white/25 bg-accent shadow-[0_0_16px_-4px_var(--glow)]"
                  : "border-line-strong bg-white/[0.06]"
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-bone shadow transition-transform ${values.isEnabled ? "translate-x-[1.375rem]" : "translate-x-1"}`}
              />
            </span>
          </label>
          <div className={`${field} border-t border-line pt-4`}>
            <label htmlFor="popup-name" className={label}>
              Name
            </label>
            <input
              id="popup-name"
              name="name"
              required
              maxLength={POPUP_LIMITS.name}
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
              aria-describedby="popup-name-hint"
              className="input"
            />
            <p id="popup-name-hint" className={small}>
              Only you see this. It tells your pop-ups apart in the list.
            </p>
          </div>
        </section>

        <section className={section}>
          <h2 className="text-lg font-semibold text-white">What it says</h2>
          <div className={field}>
            <label htmlFor="popup-eyebrow" className={label}>
              Small line on top (optional)
            </label>
            <input
              id="popup-eyebrow"
              name="eyebrow"
              maxLength={POPUP_LIMITS.eyebrow}
              value={values.eyebrow}
              onChange={(event) => set("eyebrow", event.target.value)}
              className="input"
            />
          </div>
          <div className={field}>
            <label htmlFor="popup-headline" className={label}>
              Headline
            </label>
            <input
              id="popup-headline"
              name="headline"
              required
              maxLength={POPUP_LIMITS.headline}
              value={values.headline}
              onChange={(event) => set("headline", event.target.value)}
              className="input"
            />
          </div>
          <div className={field}>
            <label htmlFor="popup-body" className={label}>
              A line or two under it (optional)
            </label>
            <textarea
              id="popup-body"
              name="body"
              rows={3}
              maxLength={POPUP_LIMITS.body}
              value={values.body}
              onChange={(event) => set("body", event.target.value)}
              className="input"
            />
          </div>
          <div className={field}>
            <label htmlFor="popup-button" className={label}>
              Button
            </label>
            <input
              id="popup-button"
              name="buttonLabel"
              required
              maxLength={POPUP_LIMITS.button}
              value={values.buttonLabel}
              onChange={(event) => set("buttonLabel", event.target.value)}
              className="input"
            />
          </div>
          {kind !== "EMAIL" ? (
            <div className={field}>
              <label htmlFor="popup-url" className={label}>
                {kind === "MESSAGE" ? "Page the button goes to" : "Page to go to after (optional)"}
              </label>
              <input
                id="popup-url"
                name="buttonUrl"
                required={kind === "MESSAGE"}
                maxLength={POPUP_LIMITS.url}
                placeholder="/collections/best-sellers"
                value={values.buttonUrl}
                onChange={(event) => set("buttonUrl", event.target.value)}
                aria-describedby="popup-url-hint"
                className="input font-mono"
              />
              <p id="popup-url-hint" className={small}>
                The part of the address after voidszn.com, starting with a slash. Just / is the home page.
              </p>
            </div>
          ) : null}
        </section>

        {kind !== "MESSAGE" ? (
          <section className={section}>
            <h2 className="text-lg font-semibold text-white">The code it gives</h2>
            <div className={field}>
              <label htmlFor="popup-code" className={label}>
                Discount code
              </label>
              <select
                id="popup-code"
                name="discountCodeId"
                value={values.discountCodeId ?? ""}
                onChange={(event) => set("discountCodeId", event.target.value || null)}
                aria-describedby="popup-code-hint"
                className="input"
              >
                <option value="">{kind === "EMAIL" ? "No code, just the sign-up" : "Pick a code"}</option>
                {/* A code that has since ended still shows, so saving doesn't quietly drop it. */}
                {values.discountCodeId && !picked ? <option value={values.discountCodeId}>A code that has ended</option> : null}
                {codes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code}: {code.summary}
                    {code.firstOrderOnly ? ", first order only" : ""}
                  </option>
                ))}
              </select>
              <p id="popup-code-hint" className={small}>
                {kind === "EMAIL"
                  ? "Shown only after they sign up, and saved to their order for them. Codes are made under Discounts. For a welcome offer, tick “First order only” on the code."
                  : "Shown on the pop-up. The button saves it to their order. Codes are made under Discounts."}
              </p>
            </div>
            {kind === "EMAIL" ? (
              <div className="flex flex-col gap-1 border-t border-line pt-4">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    name="sendsEmail"
                    checked={values.sendsEmail}
                    onChange={(event) => set("sendsEmail", event.target.checked)}
                    aria-describedby="popup-email-hint"
                    className={check}
                  />
                  <span>Also email them a welcome with the code</span>
                </label>
                <p id="popup-email-hint" className={`${small} pl-8`}>
                  The “Welcome” email, once per address. It carries the code and an unsubscribe link.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={section}>
          <h2 className="text-lg font-semibold text-white">When and where it opens</h2>
          <fieldset className="flex flex-col gap-1">
            <legend className={`${label} mb-1`}>When</legend>
            {(Object.entries(POPUP_TRIGGERS) as [PopupTrigger, string][]).map(([key, text]) => (
              <label key={key} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="trigger"
                  value={key}
                  checked={values.trigger === key}
                  onChange={() => set("trigger", key)}
                  className={check}
                />
                <span>{text}</span>
              </label>
            ))}
            {values.trigger === "DELAY" ? (
              <label className={`${field} pl-8`}>
                <span className={small}>Seconds to wait</span>
                <input
                  name="delaySeconds"
                  inputMode="numeric"
                  required
                  value={delay}
                  onChange={(event) => setDelay(event.target.value)}
                  className="input num w-28"
                />
              </label>
            ) : null}
            {values.trigger === "EXIT" ? (
              <p className={`${small} pl-8`}>
                On a computer, when the mouse heads for the top of the window. Phones can&apos;t tell, so there it
                opens after 20 seconds.
              </p>
            ) : null}
          </fieldset>
          <fieldset className="flex flex-col gap-1 border-t border-line pt-4">
            <legend className={`${label} float-left mb-1 w-full`}>Where</legend>
            {(Object.entries(POPUP_PAGES) as [PopupPages, string][]).map(([key, text]) => (
              <label key={key} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="pages"
                  value={key}
                  checked={values.pages === key}
                  onChange={() => set("pages", key)}
                  className={check}
                />
                <span>{text}</span>
              </label>
            ))}
            <p className={small}>Never at checkout, on a cart link from an email, or on an order page.</p>
          </fieldset>
          <label className={`${field} border-t border-line pt-4`}>
            <span className={label}>After someone closes it, days before it can open for them again</span>
            <input
              name="showAgainDays"
              inputMode="numeric"
              required
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              aria-describedby="popup-again-hint"
              className="input num w-28"
            />
            <span id="popup-again-hint" className={small}>
              0 means it can open on every visit.
              {kind === "EMAIL" ? " Someone who signed up is never asked again." : ""}
            </span>
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className="btn btn-accent">
            {pending ? "Saving…" : id ? "Save pop-up" : "Create pop-up"}
          </button>
          <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
            {state.error ??
              (state.saved && !pending
                ? values.isEnabled
                  ? "Saved. It's on the store now."
                  : "Saved. It's switched off, so nobody sees it."
                : "")}
          </p>
        </div>
      </form>

      {/* Outside the form: the pop-up has a form of its own, and one can't sit inside another. */}
      <aside className="flex flex-col gap-3 xl:sticky xl:top-6">
        <h2 className={label}>How it looks</h2>
        {/* The buttons in here do nothing. `inert` keeps them out of the tab order. */}
        <div inert className="glass glass-solid overflow-hidden rounded-[1.75rem] text-bone">
          <PopupCard
            preview
            headingId={previewId}
            onClose={() => undefined}
            popup={{
              id: id ?? "preview",
              kind,
              eyebrow: values.eyebrow.trim() || null,
              headline: values.headline || "Your headline",
              body: values.body,
              buttonLabel: values.buttonLabel || "Button",
              buttonUrl: values.buttonUrl || null,
              trigger: values.trigger,
              delaySeconds: 0,
              pages: values.pages,
              showAgainDays: 0,
              offer: kind === "CODE" && picked ? { code: picked.code, summary: picked.summary } : null,
            }}
          />
        </div>
        {kind === "EMAIL" ? (
          <p className={small}>
            {picked
              ? `After they sign up, it shows ${picked.code} (${picked.summary}) and saves it to their order.`
              : "After they sign up, it thanks them. No code is given."}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

/** The on/off switch in the list of pop-ups. */
export function PopupSwitch({ id, name, isEnabled }: { id: string; name: string; isEnabled: boolean }) {
  const { action, pending, onSubmit } = useFormAction(togglePopupAction, initial);
  return (
    <form action={action} onSubmit={onSubmit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="turn" value={isEnabled ? "off" : "on"} />
      <button
        type="submit"
        role="switch"
        aria-checked={isEnabled}
        aria-label={`Show ${name}`}
        disabled={pending}
        className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition-colors disabled:opacity-60 ${
          isEnabled ? "border-white/25 bg-accent shadow-[0_0_16px_-4px_var(--glow)]" : "border-line-strong bg-white/[0.06]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-5 w-5 rounded-full bg-bone shadow transition-transform ${isEnabled ? "translate-x-[1.375rem]" : "translate-x-1"}`}
        />
      </button>
    </form>
  );
}

/** Up and down arrows that change which pop-up the store tries first. */
export function PopupOrder({ id, name, first, last }: { id: string; name: string; first: boolean; last: boolean }) {
  const { action, pending, onSubmit } = useFormAction(movePopupAction, initial);
  const button =
    "inline-flex h-11 w-11 items-center justify-center rounded-full text-bone-dim transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent";
  const arrow = (direction: "up" | "down", disabled: boolean) => (
    <form action={action} onSubmit={onSubmit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button type="submit" disabled={disabled || pending} aria-label={`Move ${name} ${direction}`} className={button}>
        <svg aria-hidden="true" viewBox="0 0 12 8" className={`h-2 w-3 ${direction === "up" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 1.5 6 6.5l5-5" />
        </svg>
      </button>
    </form>
  );
  return (
    <div className="flex flex-none">
      {arrow("up", first)}
      {arrow("down", last)}
    </div>
  );
}

export function DeletePopupForm({ id }: { id: string }) {
  const { state, action, onSubmit } = useFormAction(deletePopupAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton label="Delete this pop-up" confirmLabel="Delete pop-up" />
      <p role="alert" className="text-sm text-ember">
        {state.error}
      </p>
    </form>
  );
}
