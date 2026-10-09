"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { FormError } from "@/db/queries/admin-catalog";
import { createPopup, deletePopup, movePopup, setPopupEnabled, updatePopup } from "@/db/queries/popups";
import { requireAdmin } from "@/lib/admin/session";
import {
  POPUP_LIMITS,
  POPUPS_TAG,
  type PopupContent,
  isPopupKind,
  isPopupPages,
  isPopupTrigger,
  isStorePath,
} from "@/lib/popups/shape";

export type PopupFormState = { error?: string; saved?: boolean };

const NOT_FOUND = "That pop-up could not be found.";

/** Reads the pop-up form into something the database can save, or says what to fix. */
function read(form: FormData): { input: PopupContent } | { error: string } {
  const value = (name: string) => String(form.get(name) ?? "").trim().replace(/\s+/g, " ");
  const on = (name: string) => form.get(name) === "on";

  const kind = value("kind");
  if (!isPopupKind(kind)) return { error: "Choose what kind of pop-up this is." };

  const name = value("name");
  if (!name) return { error: "Give it a name, so you can tell your pop-ups apart." };
  if (name.length > POPUP_LIMITS.name) return { error: `Keep the name under ${POPUP_LIMITS.name} characters.` };

  const eyebrow = value("eyebrow");
  if (eyebrow.length > POPUP_LIMITS.eyebrow) {
    return { error: `Keep the small line under ${POPUP_LIMITS.eyebrow} characters.` };
  }
  const headline = value("headline");
  if (!headline) return { error: "Write a headline." };
  if (headline.length > POPUP_LIMITS.headline) {
    return { error: `Keep the headline under ${POPUP_LIMITS.headline} characters.` };
  }
  const body = value("body");
  if (body.length > POPUP_LIMITS.body) return { error: `Keep the words under ${POPUP_LIMITS.body} characters.` };
  const buttonLabel = value("buttonLabel");
  if (!buttonLabel) return { error: "Write what the button says." };
  if (buttonLabel.length > POPUP_LIMITS.button) {
    return { error: `Keep the button under ${POPUP_LIMITS.button} characters.` };
  }

  const buttonUrl = kind === "EMAIL" ? "" : value("buttonUrl");
  if (kind === "MESSAGE" && !buttonUrl) {
    return { error: "Say which page the button goes to, like /collections/best-sellers." };
  }
  if (buttonUrl && (!isStorePath(buttonUrl) || buttonUrl.length > POPUP_LIMITS.url)) {
    return { error: "The button goes to a page of this store. Start it with a slash, like /collections/best-sellers." };
  }

  let discountCodeId: string | null = null;
  if (kind !== "MESSAGE" && value("discountCodeId")) {
    const id = z.string().uuid().safeParse(value("discountCodeId"));
    if (!id.success) return { error: "Pick a discount code from the list." };
    discountCodeId = id.data;
  }
  if (kind === "CODE" && !discountCodeId) return { error: "Pick the discount code this pop-up shows." };

  const trigger = value("trigger");
  if (!isPopupTrigger(trigger)) return { error: "Choose when it opens." };
  const delaySeconds = trigger === "DELAY" ? Number(value("delaySeconds")) : 6;
  if (!Number.isInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > POPUP_LIMITS.delaySeconds) {
    return { error: `The wait is a whole number of seconds, from 1 to ${POPUP_LIMITS.delaySeconds}.` };
  }
  const pages = value("pages");
  if (!isPopupPages(pages)) return { error: "Choose where it opens." };
  const showAgainDays = Number(value("showAgainDays"));
  if (!Number.isInteger(showAgainDays) || showAgainDays < 0 || showAgainDays > POPUP_LIMITS.showAgainDays) {
    return { error: `The days before it shows again is a whole number, from 0 to ${POPUP_LIMITS.showAgainDays}.` };
  }

  return {
    input: {
      name,
      kind,
      isEnabled: on("isEnabled"),
      eyebrow,
      headline,
      body,
      buttonLabel,
      buttonUrl,
      discountCodeId,
      sendsEmail: kind === "EMAIL" && on("sendsEmail"),
      trigger,
      delaySeconds,
      pages,
      showAgainDays,
    },
  };
}

/** The store reads its pop-ups afresh, and this screen shows what was saved. */
function changed() {
  updateTag(POPUPS_TAG);
  refresh();
}

export async function createPopupAction(_previous: PopupFormState, form: FormData): Promise<PopupFormState> {
  await requireAdmin();
  const parsed = read(form);
  if ("error" in parsed) return parsed;

  let id: string;
  try {
    id = await createPopup(getDb(), parsed.input);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  updateTag(POPUPS_TAG);
  redirect(`/admin/popups/${id}?created=1`);
}

export async function updatePopupAction(_previous: PopupFormState, form: FormData): Promise<PopupFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: NOT_FOUND };
  const parsed = read(form);
  if ("error" in parsed) return parsed;

  try {
    await updatePopup(getDb(), id.data, parsed.input);
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
  changed();
  return { saved: true };
}

/** The on/off switch in the list. */
export async function togglePopupAction(_previous: PopupFormState, form: FormData): Promise<PopupFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: NOT_FOUND };
  await setPopupEnabled(getDb(), id.data, form.get("turn") === "on");
  changed();
  return { saved: true };
}

/** Moves a pop-up up or down the order the store tries them in. */
export async function movePopupAction(_previous: PopupFormState, form: FormData): Promise<PopupFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  const direction = form.get("direction");
  if (!id.success || (direction !== "up" && direction !== "down")) return { error: NOT_FOUND };
  await movePopup(getDb(), id.data, direction);
  changed();
  return { saved: true };
}

export async function deletePopupAction(_previous: PopupFormState, form: FormData): Promise<PopupFormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: NOT_FOUND };
  await deletePopup(getDb(), id.data);
  updateTag(POPUPS_TAG);
  redirect("/admin/popups?deleted=1");
}
