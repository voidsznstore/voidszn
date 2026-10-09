import type { CSSProperties } from "react";
import type { Banner } from "@/lib/banner/shape";

/**
 * The moving banner under the header. The messages run in a loop, separated by
 * a small eclipse. Hovering pauses it. For anyone who has asked their device to
 * cut down on motion it stands still.
 */
export function BannerStrip({ banner }: { banner: Banner }) {
  if (!banner.enabled || banner.messages.length === 0) return null;

  // Enough copies of the messages to fill a very wide screen. The strip is two
  // identical halves, and slides left by exactly one half before starting over.
  const length = banner.messages.join("").length + banner.messages.length * 4;
  const repeats = Math.max(2, Math.ceil(120 / Math.max(length, 1)));
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
