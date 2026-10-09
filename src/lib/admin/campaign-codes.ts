import type { CampaignCode } from "@/components/admin/campaign-editor";
import type { DiscountRow } from "@/db/queries/admin-discounts";

/** A discount code in the shape the campaign editor works with. */
export const toCampaignCode = (row: DiscountRow): CampaignCode => ({
  id: row.id,
  code: row.code,
  type: row.type,
  value: row.value,
  minOrderCents: row.minOrderCents,
  expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  oncePerCustomer: row.perCustomerLimit !== null,
});
