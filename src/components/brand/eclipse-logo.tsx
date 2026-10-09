type EclipseLogoProps = {
  /** Font size in px. Everything else scales from it. */
  size?: number;
  className?: string;
};

/** The VOIDSZN wordmark crossing a crescent ring. */
export function EclipseLogo({ size = 30, className = "" }: EclipseLogoProps) {
  return (
    <span
      className={`relative inline-flex items-center justify-center font-display leading-none text-white ${className}`}
      style={{ fontSize: size }}
    >
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 box-border rounded-full border border-accent"
        style={{
          width: "1.6em",
          height: "1.6em",
          margin: "-0.8em 0 0 -0.8em",
          boxShadow:
            "inset 0.07em -0.05em 0 0 var(--color-accent), 0 0 0.6em -0.1em rgb(196 98 45 / 0.7)",
        }}
      />
      <span className="relative tracking-[0.04em]">VOIDSZN</span>
    </span>
  );
}
