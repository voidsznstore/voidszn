/**
 * The moving banner under the header: what it says and what color the words are.
 * Safe to import anywhere, including the browser.
 */

export type Banner = {
  enabled: boolean;
  /** Each message scrolls past in turn. */
  messages: string[];
  /** Text color, as a hex value like "#EDEAE3". */
  color: string;
};

export const BANNER_LIMITS = { messages: 6, length: 80 };

/** The brand's own colors, offered first. Any other color can be picked too. */
export const BANNER_COLORS = [
  { name: "Bone", hex: "#EDEAE3" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Ember", hex: "#E58A55" },
  { name: "Rust", hex: "#C4622D" },
  { name: "Smoke", hex: "#A3A3A3" },
] as const;

export const DEFAULT_BANNER: Banner = {
  enabled: true,
  messages: ["Nothing is in season"],
  color: "#EDEAE3",
};

export const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

/** Cache tag for the banner. Saving it in the admin clears this. */
export const BANNER_TAG = "banner";
