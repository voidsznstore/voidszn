import type { PopupCode } from "@/components/admin/popup-form";
import type { DiscountRow } from "@/db/queries/admin-discounts";
import { discountSummary } from "@/lib/discounts/describe";

/** A discount code in the shape the pop-up editor's picker works with. */
export const toPopupCode = (row: DiscountRow): PopupCode => ({
  id: row.id,
  code: row.code,
  summary: discountSummary(row),
  firstOrderOnly: row.firstOrderOnly,
});
