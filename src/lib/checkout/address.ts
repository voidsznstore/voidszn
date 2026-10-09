/**
 * The delivery address a customer types at checkout. Used by the form and by the
 * server that checks it, so nothing here may touch the database.
 */

/** Where the store ships: the 50 states and Washington, D.C. */
export const US_STATES: [code: string, name: string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

export const isUsState = (code: string) => US_STATES.some(([known]) => known === code);

/** "32801" or "32801-1234". */
export const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

/** Digits with the usual punctuation, 7 to 15 digits in all. */
export const looksLikePhone = (value: string) =>
  /^[0-9+().\- ]{7,24}$/.test(value.trim()) && (value.match(/\d/g) ?? []).length >= 7 && (value.match(/\d/g) ?? []).length <= 15;

/**
 * Whether a ZIP code is one of Florida's. The post office gives Florida every
 * code from 320 to 349 except 340 (military mail) and three that aren't in use.
 */
export function isFloridaZip(postalCode: string): boolean {
  const prefix = Number(postalCode.trim().slice(0, 3));
  return prefix >= 320 && prefix <= 349 && ![340, 343, 345, 348].includes(prefix);
}

/**
 * Says so when a state and ZIP code can't both be right, as far as Florida goes.
 * Sales tax follows where the parcel lands, so the two have to agree.
 */
export function placeProblem(state: string, postalCode: string): string | null {
  if (!ZIP_PATTERN.test(postalCode.trim())) return null;
  const florida = state.trim().toUpperCase() === "FL";
  if (florida && !isFloridaZip(postalCode)) return "That ZIP code isn't in Florida. Check the state and ZIP code.";
  if (!florida && isFloridaZip(postalCode)) return "That ZIP code is in Florida. Check the state and ZIP code.";
  return null;
}

export type ShippingDetails = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  phone?: string;
};
