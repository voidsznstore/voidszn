"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  type MailFormState,
  markUnreadAction,
  sendNewAction,
  sendReplyAction,
} from "@/app/admin/(panel)/inbox/actions";
import { useFormAction } from "./use-form-action";

const initial: MailFormState = {};
const labelClass = "text-sm font-semibold";

function Status({ state }: { state: MailFormState }) {
  return (
    <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
      {state.error ?? state.done ?? ""}
    </p>
  );
}

export function ReplyForm({
  box,
  uid,
  to,
  subject,
  from,
}: {
  box: string;
  uid: number;
  to: string;
  subject: string;
  /** The address the reply goes out as. */
  from: string;
}) {
  const { state, action, pending, onSubmit } = useFormAction(sendReplyAction, initial);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Clear the box once the reply has gone.
  useEffect(() => {
    if (state.done && messageRef.current) messageRef.current.value = "";
  }, [state]);

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="box" value={box} />
      <input type="hidden" name="uid" value={uid} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reply-to" className={labelClass}>
            To
          </label>
          <input id="reply-to" name="to" defaultValue={to} required maxLength={1000} autoComplete="off" className="input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reply-subject" className={labelClass}>
            Subject
          </label>
          <input id="reply-subject" name="subject" defaultValue={subject} required maxLength={250} className="input" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reply-message" className={labelClass}>
          Your reply
        </label>
        <textarea
          ref={messageRef}
          id="reply-message"
          name="message"
          rows={7}
          required
          maxLength={50_000}
          aria-describedby="reply-hint"
          className="input"
        />
        <p id="reply-hint" className="text-[0.8125rem] text-smoke">
          Goes out from {from}. Their message is added underneath yours.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Sending…" : "Send reply"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

type ComposeProps = { to: string; subject: string; from: string };

/** A new email starts empty every time the page is opened. */
export function ComposeForm(props: ComposeProps) {
  const { bfcacheId } = useRouter();
  return <Compose key={bfcacheId} {...props} />;
}

function Compose({ to, subject, from }: ComposeProps) {
  const { state, action, pending, onSubmit } = useFormAction(sendNewAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="compose-to" className={labelClass}>
          To
        </label>
        <input
          id="compose-to"
          name="to"
          defaultValue={to}
          required
          maxLength={1000}
          autoComplete="off"
          aria-describedby="compose-to-hint"
          className="input"
        />
        <p id="compose-to-hint" className="text-[0.8125rem] text-smoke">
          For more than one person, put a comma between the addresses.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="compose-subject" className={labelClass}>
          Subject
        </label>
        <input id="compose-subject" name="subject" defaultValue={subject} required maxLength={250} className="input" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="compose-message" className={labelClass}>
          Message
        </label>
        <textarea id="compose-message" name="message" rows={12} required maxLength={50_000} className="input" />
      </div>
      <p className="text-[0.8125rem] text-smoke">Goes out from {from}.</p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Sending…" : "Send"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function MarkUnreadForm({ box, uid }: { box: string; uid: number }) {
  const { state, action, pending, onSubmit } = useFormAction(markUnreadAction, initial);
  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="box" value={box} />
      <input type="hidden" name="uid" value={uid} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center text-sm link"
      >
        {pending ? "Marking…" : "Mark as unread"}
      </button>
      <Status state={state} />
    </form>
  );
}
