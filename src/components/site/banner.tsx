import type { CSSProperties } from "react";
import type { Banner } from "@/lib/banner/shape";

/** The widest screen the banner is built to fill edge to edge. */
const WIDEST_SCREEN_PX = 8000;
/** The eclipse between two messages, with its margins. */
const MARK_PX = 67;
/** A ceiling on the copies, so a one-word banner doesn't make a huge page. */
const MAX_REPEATS = 120;

/**
 * The moving banner under the header. The messages run in a loop, separated by
 * a small eclipse. Hovering pauses it. For anyone who has asked their device to
 * cut down on motion it stands still.
 */
export function BannerStrip({ banner }: { banner: Banner }) {
  if (!banner.enabled || banner.messages.length === 0) return null;

  // The strip is two identical halves, and slides left by exactly one half before
  // starting over. For that to loop without a gap, one half has to be at least as
  // wide as the screen, and the server can't see the screen. So each half is made
  // wide enough for the widest there is (an 8K or a 32:9 ultrawide), from a low
  // guess at how much room the messages take: about 6px a letter, plus the mark.
  const onePassPx = banner.messages.reduce((sum, message) => sum + message.length * 6 + MARK_PX, 0);
  const repeats = Math.min(MAX_REPEATS, Math.max(2, Math.ceil(WIDEST_SCREEN_PX / onePassPx)));
  const half = Array.from({ length: repeats }, () => banner.messages).flat();
  // About the same reading speed whatever the length.
  const seconds = Math.max(18, Math.round(half.join("").length * 0.45 + half.length * 2));

  const run = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="marquee-run">
      {half.map((message, index) => (
        <li key={index} className="flex items-center">
          {/* Only the first pass through the messages is read out. */}
          <span aria-hidden={!hidden && index >= banner.messages.length ? true : undefined}>{message}</span>
          <span aria-hidden="true" className="marquee-mark" />
        </li>
      ))}
    </ul>
  );

  return (
    <aside
      aria-label="Announcements"
      className="marquee"
      style={{ color: banner.color, "--marquee-time": `${seconds}s` } as CSSProperties}
    >
      <div className="marquee-track">
        {run(false)}
        {run(true)}
      </div>
    </aside>
  );
}
