/** What a business expense can be filed under. The key is what the database holds. */
export const EXPENSE_CATEGORIES = {
  ADS: "Ads",
  SUBSCRIPTIONS: "Subscriptions and software",
  SUPPLIES: "Samples and supplies",
  FEES: "Licences and filing fees",
  PAYOUTS: "Card payout fees",
  OTHER: "Other",
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const isExpenseCategory = (value: unknown): value is ExpenseCategory =>
  typeof value === "string" && value in EXPENSE_CATEGORIES;

export const categoryLabel = (category: string) =>
  isExpenseCategory(category) ? EXPENSE_CATEGORIES[category] : "Other";
