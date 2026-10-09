"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { type Box, MailError, getMessage, markUnread, sendMail } from "@/lib/mail/gmail";

export type MailFormState = { error?: string; done?: string };

const box = z.enum(["inbox", "sent"]);
const uid = z.coerce.number().int().positive();
const address = z.string().trim().toLowerCase().email("Check the email address.").max(254);
/** One address, or a few separated by commas. */
const recipients = z
  .string()
  .trim()
  .min(1, "Enter who it's going to.")
  .max(1000)
  .transform((value) => value.split(/[,;]\s*|\s+/).filter(Boolean))
  .pipe(z.array(address).min(1, "Enter who it's going to.").max(10, "Send to 10 people or fewer at a time."));
const subject = z.string().trim().min(1, "Give it a subject.").max(250);
const message = z.string().trim().min(1, "Write a message.").max(50_000);

const failure = (error: unknown): MailFormState => {
  if (error instanceof MailError) return { error: error.message };
  console.error("[inbox] Action failed", error);
  return { error: "Something went wrong. Nothing was sent. Try again." };
};

/** The original message, quoted under a reply the way mail apps do it. */
function quote(original: { from: { name: string; address: string }; date: Date | null; text: string }): string {
  const who = original.from.name ? `${original.from.name} <${original.from.address}>` : original.from.address;
  const when = original.date ? `On ${formatDateTime(original.date)}, ` : "";
  const lines = original.text.trim().split("\n").slice(0, 400);
  return `\n\n${when}${who} wrote:\n${lines.map((line) => `> ${line}`).join("\n")}`;
}

export async function sendReplyAction(_previous: MailFormState, form: FormData): Promise<MailFormState> {
  await requireAdmin();
  const parsed = z
    .object({ box, uid, to: recipients, subject, message })
    .safeParse({
      box: form.get("box"),
      uid: form.get("uid"),
      to: form.get("to") ?? "",
      subject: form.get("subject") ?? "",
      message: form.get("message") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the reply." };

  try {
    // Read again from Gmail, so the reply is tied to the real message and quotes it as sent.
    const original = await getMessage(parsed.data.box, parsed.data.uid);
    if (!original) return { error: "That message is no longer in the mailbox." };
    await sendMail({
      to: parsed.data.to.join(", "),
      subject: parsed.data.subject,
      text: parsed.data.message + quote(original),
      inReplyTo: {
        box: parsed.data.box,
        uid: parsed.data.uid,
        messageId: original.messageId,
        references: original.references,
      },
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { done: `Sent to ${parsed.data.to.join(", ")}.` };
}

export async function sendNewAction(_previous: MailFormState, form: FormData): Promise<MailFormState> {
  await requireAdmin();
  const parsed = z
    .object({ to: recipients, subject, message })
    .safeParse({
      to: form.get("to") ?? "",
      subject: form.get("subject") ?? "",
      message: form.get("message") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the email." };

  try {
    await sendMail({
      to: parsed.data.to.join(", "),
      subject: parsed.data.subject,
      text: parsed.data.message,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/admin/inbox?box=sent&sent=1");
}

export async function markUnreadAction(_previous: MailFormState, form: FormData): Promise<MailFormState> {
  await requireAdmin();
  const parsed = z.object({ box, uid }).safeParse({ box: form.get("box"), uid: form.get("uid") });
  if (!parsed.success) return { error: "That message could not be found." };
  try {
    await markUnread(parsed.data.box as Box, parsed.data.uid);
  } catch (error) {
    return failure(error);
  }
  redirect("/admin/inbox");
}
