import "server-only";
import { z } from "zod";
import { getDb } from "@/db";
import { getPopup, popupSource } from "@/db/queries/popups";
import { claimWelcome, joinList, releaseWelcome } from "@/db/queries/subscribers";
import { discountSummary } from "@/lib/discounts/describe";
import { usableEmailDiscount } from "@/lib/email/automation";
import { marketingEmail } from "@/lib/email/campaigns";
import { CAMPAIGN_PRESETS } from "@/lib/email/presets";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { whyHidden } from "./index";

export type JoinResult =
  | {
      ok: true;
      /** The reward, when the pop-up gives one. */
      code: string | null;
      /** "10% off", with any minimum. */
      summary: string | null;
      firstOrderOnly: boolean;
    }
  | { ok: false; error: string };

const address = z.string().trim().toLowerCase().max(254).email();

/** No more welcome emails than this go out in an hour, however many sign-ups arrive. */
const WELCOMES_PER_HOUR = 120;

/**
 * Signs an address up through an email pop-up and hands back the code it
 * promised. The answer is the same whether or not the address was already on
 * the list, so the form can't be used to find out who is.
 */
export async function joinFromPopup(popupId: string, rawEmail: string): Promise<JoinResult> {
  const ended = { ok: false as const, error: "That offer has ended." };
  if (!/^[0-9a-f-]{36}$/i.test(popupId)) return ended;
  const db = getDb();
  const popup = await getPopup(db, popupId);
  if (!popup || !popup.isEnabled || popup.kind !== "EMAIL" || whyHidden(popup)) return ended;

  const email = address.safeParse(rawEmail);
  if (!email.success) return { ok: false, error: "Enter your email address, like name@example.com." };

  const joined = await joinList(db, email.data, popupSource(popup.id));
  // Someone who unsubscribed stays unsubscribed. They still get the code on screen.
  if (joined.token && popup.sendsEmail) {
    try {
      await sendWelcome(email.data, joined.token, popup.discountCodeId);
    } catch (error) {
      console.error("[popups] The welcome email could not be sent", error);
    }
  }

  return {
    ok: true,
    code: popup.discount?.code ?? null,
    summary: popup.discount ? discountSummary(popup.discount) : null,
    firstOrderOnly: popup.discount?.firstOrderOnly ?? false,
  };
}

/** The welcome email, once per address ever. */
async function sendWelcome(email: string, token: string, discountCodeId: string | null): Promise<void> {
  if (!isEmailConfigured()) return;
  const preset = CAMPAIGN_PRESETS.find((candidate) => candidate.key === "welcome");
  if (!preset) return;
  const db = getDb();
  if (!(await claimWelcome(db, email, WELCOMES_PER_HOUR))) return;

  const result = await sendEmail(
    marketingEmail(
      {
        subject: preset.subject,
        preheader: preset.preheader,
        heading: preset.heading,
        body: preset.body,
        imageUrl: null,
        buttonLabel: preset.buttonLabel,
        buttonUrl: preset.buttonUrl,
        // Left out if this person couldn't use it, so the email never offers a dead code.
        discount: await usableEmailDiscount(db, discountCodeId, { email }),
      },
      email,
      token,
      `welcome/${token}`,
    ),
  );
  // Not sent, so a later sign-up may try again.
  if (!result.ok) await releaseWelcome(db, email);
}
