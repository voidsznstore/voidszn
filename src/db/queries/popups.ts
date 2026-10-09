import { asc, eq, sql } from "drizzle-orm";
import { POPUP_LIMITS, type PopupContent } from "@/lib/popups/shape";
import type { Database } from "../index";
import { discountCodes, popups, subscribers } from "../schema";
import { FormError } from "./admin-catalog";

export type PopupRow = typeof popups.$inferSelect;
export type PopupWithCode = PopupRow & { discount: typeof discountCodes.$inferSelect | null };

/** What a sign-up through a pop-up is filed under, so they can be counted. */
export const popupSource = (popupId: string) => `popup:${popupId}`;

const inOrder = [asc(popups.position), asc(popups.createdAt)] as const;

/** Every pop-up in the order the store tries them, with its code and how many people it signed up. */
export async function listPopups(db: Database): Promise<(PopupWithCode & { signups: number })[]> {
  const rows = await db
    .select({
      popup: popups,
      discount: discountCodes,
      signups: sql<number>`(select count(*)::int from ${subscribers} where ${subscribers.source} = 'popup:' || ${popups.id}::text)`,
    })
    .from(popups)
    .leftJoin(discountCodes, eq(popups.discountCodeId, discountCodes.id))
    .orderBy(...inOrder);
  return rows.map((row) => ({ ...row.popup, discount: row.discount, signups: row.signups }));
}

/** The pop-ups that are switched on, in order. Whether each can really show is decided by the caller. */
export async function enabledPopups(db: Database): Promise<PopupWithCode[]> {
  const rows = await db
    .select({ popup: popups, discount: discountCodes })
    .from(popups)
    .leftJoin(discountCodes, eq(popups.discountCodeId, discountCodes.id))
    .where(eq(popups.isEnabled, true))
    .orderBy(...inOrder);
  return rows.map((row) => ({ ...row.popup, discount: row.discount }));
}

export async function getPopup(db: Database, id: string): Promise<PopupWithCode | null> {
  const [row] = await db
    .select({ popup: popups, discount: discountCodes })
    .from(popups)
    .leftJoin(discountCodes, eq(popups.discountCodeId, discountCodes.id))
    .where(eq(popups.id, id))
    .limit(1);
  return row ? { ...row.popup, discount: row.discount } : null;
}

const fields = (input: PopupContent) => ({
  name: input.name,
  kind: input.kind,
  isEnabled: input.isEnabled,
  eyebrow: input.eyebrow || null,
  headline: input.headline,
  body: input.body,
  buttonLabel: input.buttonLabel,
  buttonUrl: input.buttonUrl || null,
  discountCodeId: input.discountCodeId,
  sendsEmail: input.sendsEmail,
  trigger: input.trigger,
  delaySeconds: input.delaySeconds,
  pages: input.pages,
  showAgainDays: input.showAgainDays,
});

/** Postgres's code for "that row points at something that isn't there". */
const isMissingReference = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23503" ||
    (error as { cause?: { code?: string } }).cause?.code === "23503");

const NO_CODE = "That discount code no longer exists. Pick another.";

/** Adds a pop-up at the end of the list. */
export async function createPopup(db: Database, input: PopupContent): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const [{ count, last }] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          last: sql<number>`coalesce(max(${popups.position}), -1)::int`,
        })
        .from(popups);
      if (count >= POPUP_LIMITS.count) {
        throw new FormError(`The store keeps up to ${POPUP_LIMITS.count} pop-ups. Delete one you no longer use first.`);
      }
      const [row] = await tx
        .insert(popups)
        .values({ ...fields(input), position: last + 1 })
        .returning({ id: popups.id });
      return row.id;
    });
  } catch (error) {
    if (isMissingReference(error)) throw new FormError(NO_CODE);
    throw error;
  }
}

/** Saves a pop-up's words and settings. Its kind never changes. */
export async function updatePopup(db: Database, id: string, input: PopupContent): Promise<void> {
  const rest: Partial<ReturnType<typeof fields>> = fields(input);
  delete rest.kind;
  let updated: { id: string }[];
  try {
    updated = await db
      .update(popups)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(popups.id, id))
      .returning({ id: popups.id });
  } catch (error) {
    if (isMissingReference(error)) throw new FormError(NO_CODE);
    throw error;
  }
  if (updated.length === 0) throw new FormError("That pop-up no longer exists.");
}

export async function setPopupEnabled(db: Database, id: string, isEnabled: boolean): Promise<void> {
  await db.update(popups).set({ isEnabled, updatedAt: new Date() }).where(eq(popups.id, id));
}

export async function deletePopup(db: Database, id: string): Promise<void> {
  await db.delete(popups).where(eq(popups.id, id));
}

/** Moves a pop-up one place earlier or later in the order the store tries them. */
export async function movePopup(db: Database, id: string, direction: "up" | "down"): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: popups.id })
      .from(popups)
      .orderBy(...inOrder)
      .for("update");
    const from = rows.findIndex((row) => row.id === id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= rows.length) return;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    // Renumber the whole list, so positions never collide whatever they were before.
    for (const [position, row] of rows.entries()) {
      await tx.update(popups).set({ position }).where(eq(popups.id, row.id));
    }
  });
}
