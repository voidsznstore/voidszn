"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import {
  type CampaignResult,
  deleteCampaignAction,
  saveCampaignAction,
  sendCampaignAction,
  sendTestAction,
} from "@/app/admin/(panel)/campaigns/actions";
import { discountSummary } from "@/lib/discounts/describe";
import { CAMPAIGN_PRESETS, type CampaignPreset, hasPlaceholder } from "@/lib/email/presets";
import { type CampaignContent, type EmailDiscount, campaignEmail } from "@/lib/email/templates";
import { ConfirmButton } from "./confirm-button";
import { EmailPreview } from "./email-preview";
import { uploadPhoto } from "./photo-upload";
import { useFormAction } from "./use-form-action";

/** A discount code that can be put in a campaign. Dates travel as text. */
export type CampaignCode = Omit<EmailDiscount, "expiresAt"> & { id: string; expiresAt: string | null };

/** What the editor holds: the words, plus which code is picked. */
export type CampaignDraft = {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
  discountCodeId: string | null;
};

export const BLANK_CAMPAIGN: CampaignDraft = {
  subject: "",
  preheader: "",
  heading: "",
  body: "",
  imageUrl: null,
  buttonLabel: "",
  buttonUrl: "",
  discountCodeId: null,
};

type Props = {
  id?: string;
  content: CampaignDraft;
  /** Codes that can be used right now or will be soon. */
  codes: CampaignCode[];
  /** How many people the campaign would go to right now. */
  audience: number;
  /** The signed-in admin's address, where tests go. */
  testAddress: string;
  canUpload: boolean;
  /** Why the campaign can't be sent to everyone yet, if it can't. */
  blocked: string | null;
};

/** A new campaign starts empty every time the page is opened. */
export function NewCampaignEditor(props: Props) {
  const { bfcacheId } = useRouter();
  return <CampaignEditor key={bfcacheId} {...props} />;
}

export function CampaignEditor({
  id,
  content,
  codes,
  audience,
  testAddress,
  canUpload,
  blocked,
}: Props) {
  const router = useRouter();
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  // A new campaign gets its id on the first save and keeps it, so saving or
  // sending again is always the same campaign, never a second one.
  const draftId = useRef<string | null>(id ?? null);
  const [pending, startTransition] = useTransition();
  const [working, setWorking] = useState<"save" | "test" | "send" | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Set once the draft exists in the database, which is when it can be deleted.
  const [savedId, setSavedId] = useState(id ?? null);
  const [uploading, setUploading] = useState(false);

  const [subject, setSubject] = useState(content.subject);
  const [preheader, setPreheader] = useState(content.preheader);
  const [headline, setHeadline] = useState(content.heading);
  const [body, setBody] = useState(content.body);
  const [imageUrl, setImageUrl] = useState(content.imageUrl);
  const [buttonLabel, setButtonLabel] = useState(content.buttonLabel);
  const [buttonUrl, setButtonUrl] = useState(content.buttonUrl);
  const [discountCodeId, setDiscountCodeId] = useState(content.discountCodeId);
  // The template last picked, so the editor can say when it expects a code.
  const [preset, setPreset] = useState<CampaignPreset | null>(null);
  const [previewWidth, setPreviewWidth] = useState<"phone" | "desktop">("phone");

  const current: CampaignDraft = {
    subject,
    preheader,
    heading: headline,
    body,
    imageUrl,
    buttonLabel,
    buttonUrl,
    discountCodeId,
  };
  const picked = codes.find((code) => code.id === discountCodeId) ?? null;
  const unfilled = [subject, preheader, headline, body].some(hasPlaceholder);

  // Shown exactly as it will arrive, with a stand-in for the unsubscribe link.
  const previewContent: CampaignContent = {
    subject: subject || "Your subject",
    preheader,
    heading: headline,
    body: body || "Your message.",
    imageUrl,
    buttonLabel,
    buttonUrl,
    discount: picked
      ? { ...picked, expiresAt: picked.expiresAt ? new Date(picked.expiresAt) : null }
      : null,
  };
  const preview = campaignEmail(previewContent, "#").html;

  function applyPreset(next: CampaignPreset) {
    setPreset(next);
    setSubject(next.subject);
    setPreheader(next.preheader);
    setHeadline(next.heading);
    setBody(next.body);
    setButtonLabel(next.buttonLabel);
    setButtonUrl(next.buttonUrl);
    setMessage(null);
  }

  function run(
    kind: "save" | "test" | "send",
    action: (input: unknown) => Promise<CampaignResult>,
  ) {
    setMessage(null);
    setWorking(kind);
    draftId.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await action({ id: draftId.current, ...current }).catch(() => ({
        error: "Something went wrong. Check your connection and try again.",
      }));
      setWorking(null);
      setConfirming(false);
      if ("error" in result) {
        setMessage({ text: result.error, isError: true });
        return;
      }
      if (kind === "send") {
        router.replace(`/admin/campaigns/${result.id}`);
        return;
      }
      setMessage({ text: result.done ?? "Saved.", isError: false });
      // A new campaign now has an address of its own. Changing the address in place
      // keeps this screen, and the message just shown, where they are.
      if (!id) window.history.replaceState(null, "", `/admin/campaigns/${result.id}`);
      setSavedId(result.id);
    });
  }

  async function handlePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      setImageUrl((await uploadPhoto(file)).url);
    } catch (problem) {
      setMessage({
        text:
          problem instanceof Error
            ? problem.message
            : "The photo could not be added.",
        isError: true,
      });
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  const panel = "flex flex-col gap-4 panel p-5";
  const heading = "text-lg font-semibold text-white";
  const labelClass = "text-sm font-semibold";
  const small = "text-[0.8125rem] text-smoke";
  const busy = pending || uploading;

  return (
    <div className="grid items-start gap-6 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run("save", saveCampaignAction);
          }}
          className="flex flex-col gap-6"
        >
          <details className={`${panel} group`} open={!id}>
            <summary className="flex min-h-11 list-none items-center justify-between gap-4">
              <span className={heading}>Start from a template</span>
              <span className="link text-sm text-smoke group-open:hidden">Show</span>
              <span className="link hidden text-sm text-smoke group-open:inline">Hide</span>
            </summary>
            <p className={small}>
              Picking one fills in the words below, replacing what is there. Change anything you
              like afterwards.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {CAMPAIGN_PRESETS.map((option) => (
                <li key={option.key}>
                  <button
                    type="button"
                    onClick={() => applyPreset(option)}
                    aria-pressed={preset?.key === option.key}
                    className={`flex h-full w-full flex-col gap-1 rounded-field border px-4 py-3 text-left transition-colors ${
                      preset?.key === option.key
                        ? "border-bone bg-white/[0.09]"
                        : "border-line-strong bg-white/[0.03] hover:border-bone/60 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2 font-semibold text-white">
                      {option.name}
                      {option.wantsDiscount ? <span className="tag tag-warn">With a code</span> : null}
                    </span>
                    <span className={small}>{option.when}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>

          <section className={panel}>
            <h2 className={heading}>The email</h2>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${fieldId}-subject`} className={labelClass}>
                Subject
              </label>
              <input
                id={`${fieldId}-subject`}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={150}
                required
                aria-describedby={`${fieldId}-subject-hint`}
                className="input"
              />
              <p id={`${fieldId}-subject-hint`} className={small}>
                {subject.length > 50
                  ? `${subject.length} characters. Phones cut subjects off at around 40.`
                  : "Say the offer or the news. Phones show about 40 characters."}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${fieldId}-preheader`} className={labelClass}>
                Preview line (optional)
              </label>
              <input
                id={`${fieldId}-preheader`}
                value={preheader}
                onChange={(event) => setPreheader(event.target.value)}
                maxLength={150}
                aria-describedby={`${fieldId}-preheader-hint`}
                className="input"
              />
              <p id={`${fieldId}-preheader-hint`} className={small}>
                The grey text inboxes show after the subject.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${fieldId}-headline`} className={labelClass}>
                Headline (optional)
              </label>
              <input
                id={`${fieldId}-headline`}
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                maxLength={80}
                aria-describedby={`${fieldId}-headline-hint`}
                className="input"
              />
              <p id={`${fieldId}-headline-hint`} className={small}>
                The big line at the top of the email. Left empty, the subject is used.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${fieldId}-body`} className={labelClass}>
                Message
              </label>
              <textarea
                id={`${fieldId}-body`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={7}
                maxLength={10_000}
                required
                aria-describedby={`${fieldId}-body-hint`}
                className="input"
              />
              <p id={`${fieldId}-body-hint`} className={small}>
                Two or three short lines do best. Leave an empty line between paragraphs.
              </p>
            </div>
          </section>

          <section className={panel}>
            <h2 className={heading}>Discount code (optional)</h2>
            {codes.length === 0 ? (
              <p className="text-bone-dim">
                There are no codes to offer yet.{" "}
                <Link href="/admin/discounts/new" className="link">
                  Create a code
                </Link>{" "}
                and it will show up here.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${fieldId}-code`} className={labelClass}>
                  Code to offer
                </label>
                <select
                  id={`${fieldId}-code`}
                  value={discountCodeId ?? ""}
                  onChange={(event) => setDiscountCodeId(event.target.value || null)}
                  aria-describedby={`${fieldId}-code-hint`}
                  className="input"
                >
                  <option value="">No code</option>
                  {codes.map((code) => (
                    <option key={code.id} value={code.id}>
                      {code.code} ({discountSummary(code)})
                    </option>
                  ))}
                </select>
                <p id={`${fieldId}-code-hint`} className={small}>
                  {picked
                    ? "The email shows the code in a box, and the button adds it for whoever taps through."
                    : preset?.wantsDiscount
                      ? "This template is written around a code. Pick one, or reword the message."
                      : "Shown in a box above the button. The button then adds it for whoever taps through."}{" "}
                  <Link href="/admin/discounts" className="link">
                    Manage codes
                  </Link>
                </p>
              </div>
            )}
          </section>

          <section className={panel}>
            <h2 className={heading}>Photo and button (optional)</h2>
            {imageUrl ? (
              <div className="flex flex-wrap items-center gap-4">
                {/* A plain image: it is shown here exactly as the email will load it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="The photo at the top of the email"
                  className="h-24 w-24 rounded-field object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="inline-flex min-h-11 items-center text-sm link"
                >
                  Remove photo
                </button>
              </div>
            ) : canUpload ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${fieldId}-photo`} className={labelClass}>
                  Photo at the top
                </label>
                <input
                  ref={fileInput}
                  id={`${fieldId}-photo`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={(event) => void handlePhoto(event.target.files)}
                  className="text-sm text-smoke file:mr-4 file:min-h-11 file:cursor-pointer file:rounded-full file:border file:border-solid file:border-line-strong file:bg-white/[0.07] file:px-5 file:font-semibold file:text-bone hover:file:bg-white/[0.12]"
                />
                {uploading ? <p className={small}>Adding the photo…</p> : null}
              </div>
            ) : (
              <p className={small}>
                Photo storage isn&apos;t set up, so photos can&apos;t be added.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={`${fieldId}-button-label`}
                  className={labelClass}
                >
                  Button words
                </label>
                <input
                  id={`${fieldId}-button-label`}
                  value={buttonLabel}
                  onChange={(event) => setButtonLabel(event.target.value)}
                  maxLength={40}
                  placeholder="Shop the drop"
                  className="input"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${fieldId}-button-url`} className={labelClass}>
                  Button link
                </label>
                <input
                  id={`${fieldId}-button-url`}
                  value={buttonUrl}
                  onChange={(event) => setButtonUrl(event.target.value)}
                  maxLength={500}
                  inputMode="url"
                  placeholder="https://www.voidszn.com/collections/just-in"
                  className="input"
                />
              </div>
            </div>
          </section>

          <section className={panel}>
            <h2 className={heading}>Send</h2>
            <p className="text-bone-dim">
              {audience === 0
                ? "Nobody has agreed to get marketing emails yet. Tick “Agreed to get marketing emails” on a customer to add them."
                : `This goes to ${audience} ${audience === 1 ? "person" : "people"}: everyone who agreed to get marketing emails and hasn't unsubscribed.`}
            </p>
            {blocked ? (
              <p className="notice p-3 text-sm text-bone-dim">
                {blocked}
              </p>
            ) : null}
            {unfilled ? (
              <p className="notice p-3 text-sm text-bone-dim">
                There is still a part in [BRACKETS] to fill in before this can be sent.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="btn btn-glass min-h-11 px-5"
              >
                {working === "save" ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("test", sendTestAction)}
                className="btn btn-glass min-h-11 px-5"
              >
                {working === "test" ? "Sending…" : "Send a test to me"}
              </button>
            </div>
            <p className={small}>Tests go to {testAddress}.</p>

            {confirming ? (
              <div className="notice flex flex-col gap-3 p-4">
                <p>
                  Send this to {audience} {audience === 1 ? "person" : "people"}{" "}
                  now? It can&apos;t be unsent.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run("send", sendCampaignAction)}
                    className="btn btn-accent min-h-11 px-5"
                  >
                    {working === "send" ? "Sending…" : "Yes, send it"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                    className="inline-flex min-h-11 items-center text-sm link"
                  >
                    Not yet
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy || audience === 0 || blocked !== null || unfilled}
                onClick={() => setConfirming(true)}
                className="btn btn-accent self-start"
              >
                Send to {audience} {audience === 1 ? "person" : "people"}
              </button>
            )}

            <p
              role="alert"
              aria-live="polite"
              className={`text-sm ${message?.isError ? "text-ember" : "text-smoke"}`}
            >
              {message?.text ?? ""}
            </p>
          </section>
        </form>
        {savedId ? <DeleteDraft id={savedId} /> : null}
      </div>

      <section className={`${panel} xl:sticky xl:top-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={heading}>How it will look</h2>
          <div className="flex gap-1.5">
            {(["phone", "desktop"] as const).map((width) => (
              <button
                key={width}
                type="button"
                aria-pressed={previewWidth === width}
                onClick={() => setPreviewWidth(width)}
                className="chip min-h-9 px-4 capitalize"
              >
                {width}
              </button>
            ))}
          </div>
        </div>
        <EmailPreview html={preview} title="Preview of the email" narrow={previewWidth === "phone"} />
      </section>
    </div>
  );
}

function DeleteDraft({ id }: { id: string }) {
  const { state, action, onSubmit } = useFormAction(deleteCampaignAction, {});
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton label="Delete this draft" confirmLabel="Delete draft" />
      <p role="alert" className="text-sm text-ember">
        {state.error}
      </p>
    </form>
  );
}
