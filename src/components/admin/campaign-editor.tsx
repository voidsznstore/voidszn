"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import {
  type CampaignResult,
  deleteCampaignAction,
  saveCampaignAction,
  sendCampaignAction,
  sendTestAction,
} from "@/app/admin/(panel)/campaigns/actions";
import { type CampaignContent, campaignEmail } from "@/lib/email/templates";
import { ConfirmButton } from "./confirm-button";
import { uploadPhoto } from "./photo-upload";
import { useFormAction } from "./use-form-action";

type Props = {
  id?: string;
  content: CampaignContent;
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
  audience,
  testAddress,
  canUpload,
  blocked,
}: Props) {
  const router = useRouter();
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [working, setWorking] = useState<"save" | "test" | "send" | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [subject, setSubject] = useState(content.subject);
  const [preheader, setPreheader] = useState(content.preheader);
  const [body, setBody] = useState(content.body);
  const [imageUrl, setImageUrl] = useState(content.imageUrl);
  const [buttonLabel, setButtonLabel] = useState(content.buttonLabel);
  const [buttonUrl, setButtonUrl] = useState(content.buttonUrl);

  const current: CampaignContent = {
    subject,
    preheader,
    body,
    imageUrl,
    buttonLabel,
    buttonUrl,
  };
  // Shown exactly as it will arrive, with a stand-in for the unsubscribe link.
  const preview = campaignEmail(
    {
      ...current,
      subject: subject || "Your subject",
      body: body || "Your message.",
    },
    "#",
  ).html;

  function run(
    kind: "save" | "test" | "send",
    action: (input: unknown) => Promise<CampaignResult>,
  ) {
    setMessage(null);
    setWorking(kind);
    startTransition(async () => {
      const result = await action({ id, ...current }).catch(() => ({
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
      if (!id) router.replace(`/admin/campaigns/${result.id}`);
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

  const panel = "flex flex-col gap-4 border border-line bg-ash-soft p-5";
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
                className="input"
              />
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
              <label htmlFor={`${fieldId}-body`} className={labelClass}>
                Message
              </label>
              <textarea
                id={`${fieldId}-body`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={10}
                maxLength={10_000}
                required
                aria-describedby={`${fieldId}-body-hint`}
                className="input"
              />
              <p id={`${fieldId}-body-hint`} className={small}>
                Leave an empty line between paragraphs.
              </p>
            </div>
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
                  className="h-24 w-24 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
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
                  className="text-sm file:mr-4 file:min-h-11 file:border file:border-bone file:bg-transparent file:px-5 file:font-semibold file:text-bone"
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
              <p className="border border-accent p-3 text-sm text-bone-dim">
                {blocked}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="btn btn-outline min-h-11 px-5 disabled:opacity-60"
              >
                {working === "save" ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("test", sendTestAction)}
                className="btn btn-outline min-h-11 px-5 disabled:opacity-60"
              >
                {working === "test" ? "Sending…" : "Send a test to me"}
              </button>
            </div>
            <p className={small}>Tests go to {testAddress}.</p>

            {confirming ? (
              <div className="flex flex-col gap-3 border border-line-strong p-4">
                <p>
                  Send this to {audience} {audience === 1 ? "person" : "people"}{" "}
                  now? It can&apos;t be unsent.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run("send", sendCampaignAction)}
                    className="btn btn-accent min-h-11 px-5 disabled:opacity-60"
                  >
                    {working === "send" ? "Sending…" : "Yes, send it"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                    className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                  >
                    Not yet
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy || audience === 0 || blocked !== null}
                onClick={() => setConfirming(true)}
                className="btn btn-accent self-start disabled:opacity-40"
              >
                Send to {audience} {audience === 1 ? "person" : "people"}
              </button>
            )}

            <p
              role="alert"
              aria-live="polite"
              className={`text-sm ${message?.isError ? "text-accent" : "text-smoke"}`}
            >
              {message?.text ?? ""}
            </p>
          </section>
        </form>
        {id ? <DeleteDraft id={id} /> : null}
      </div>

      <section className={`${panel} xl:sticky xl:top-6`}>
        <h2 className={heading}>How it will look</h2>
        <iframe
          title="Preview of the email"
          sandbox=""
          srcDoc={preview}
          className="h-[44rem] w-full border border-line bg-white"
        />
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
      <p role="alert" className="text-sm text-accent">
        {state.error}
      </p>
    </form>
  );
}
