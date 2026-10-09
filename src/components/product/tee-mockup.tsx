import type { Graphic } from "@/lib/catalog/types";

type TeeMockupProps = {
  /** Garment color. */
  color: string;
  /** Print color. */
  ink: string;
  graphic: Graphic;
  view?: "front" | "back";
  label: string;
  className?: string;
};

const FRONT_BODY =
  "M140 38 Q200 80 260 38 L332 66 L392 150 L338 186 L310 158 L310 420 Q310 428 302 428 L98 428 Q90 428 90 420 L90 158 L62 186 L8 150 L68 66 Z";
const BACK_BODY =
  "M140 38 Q200 54 260 38 L332 66 L392 150 L338 186 L310 158 L310 420 Q310 428 302 428 L98 428 Q90 428 90 420 L90 158 L62 186 L8 150 L68 66 Z";

function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

function Print({ graphic, ink }: { graphic: Graphic; ink: string }) {
  switch (graphic) {
    case "rings":
      return (
        <g fill="none" stroke={ink} strokeWidth="6">
          <circle cx="200" cy="215" r="58" />
          <circle cx="200" cy="215" r="39" />
          <circle cx="200" cy="215" r="20" />
        </g>
      );
    case "grid":
      return (
        <g fill={ink}>
          {[0, 1, 2, 3].flatMap((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={148 + col * 28}
                y={163 + row * 28}
                width="20"
                height="20"
              />
            )),
          )}
        </g>
      );
    case "bars":
      return (
        <g fill={ink}>
          {[120, 100, 80, 60, 40].map((width, index) => (
            <rect
              key={width}
              x={200 - width / 2}
              y={165 + index * 22}
              width={width}
              height="12"
            />
          ))}
        </g>
      );
    case "arc":
      return (
        <g fill={ink}>
          <path d="M140 236 A60 60 0 0 1 260 236 Z" />
          <rect x="140" y="248" width="120" height="8" />
        </g>
      );
  }
}

/**
 * Drawn stand-in for a product photo. Replaced by real photography once
 * products come from the database.
 */
export function TeeMockup({
  color,
  ink,
  graphic,
  view = "front",
  label,
  className = "",
}: TeeMockupProps) {
  const seam = isLight(color) ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.2)";

  return (
    <svg viewBox="0 0 400 466" role="img" aria-label={label} className={className}>
      <path
        d={view === "front" ? FRONT_BODY : BACK_BODY}
        fill={color}
        stroke={seam}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M90 158 L104 92" fill="none" stroke={seam} strokeWidth="2" />
      <path d="M310 158 L296 92" fill="none" stroke={seam} strokeWidth="2" />
      {view === "front" ? (
        <>
          <path
            d="M146 44 Q200 90 254 44"
            fill="none"
            stroke={seam}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <Print graphic={graphic} ink={ink} />
        </>
      ) : (
        <path
          d="M146 44 Q200 62 254 44"
          fill="none"
          stroke={seam}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
