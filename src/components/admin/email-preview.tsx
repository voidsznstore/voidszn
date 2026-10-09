/**
 * Shows an email exactly as it will arrive. The frame is locked down: nothing
 * inside it can run scripts, submit forms or reach the admin around it.
 */
export function EmailPreview({
  html,
  title,
  narrow = false,
}: {
  html: string;
  title: string;
  /** Phone width. Most email is opened on a phone. */
  narrow?: boolean;
}) {
  return (
    <div className="flex justify-center rounded-field bg-black/40 p-2">
      <iframe
        title={title}
        sandbox=""
        srcDoc={html}
        className={`h-[44rem] w-full rounded-[0.625rem] border border-line bg-void ${narrow ? "max-w-[24rem]" : ""}`}
      />
    </div>
  );
}
