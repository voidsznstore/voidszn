import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";

/**
 * A column of figures laid out like a till receipt: what it is on the left, the
 * amount on the right. Used for the books and for every payout.
 */
export function MoneyRows({ children, label }: { children: ReactNode; label: string }) {
  return (
    <dl aria-label={label} className="flex flex-col text-[0.9375rem]">
      {children}
    </dl>
  );
}

type RowProps = {
  label: ReactNode;
  cents: number;
  /** Shown with a minus sign: money going out or being taken off. */
  minus?: boolean;
  /** A result line: heavier, with a rule above it. */
  total?: boolean;
  /** The line the whole receipt is for. */
  grand?: boolean;
  /** A quiet line of explanation under the label. */
  note?: ReactNode;
  /** Set in from the edge, for the parts that make up the line above. */
  inset?: boolean;
};

export function MoneyRow({ label, cents, minus, total, grand, note, inset }: RowProps) {
  // Zero is plain zero, never "minus zero".
  const shown = cents === 0 ? 0 : minus ? -Math.abs(cents) : cents;
  const amount = shown < 0 ? `−${formatMoney(Math.abs(shown))}` : formatMoney(shown);
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        grand
          ? "mt-1 border-t border-line-strong pt-3 text-lg font-semibold text-white"
          : total
            ? "mt-1 border-t border-line pt-3 font-semibold text-white"
            : "text-bone-dim"
      } ${inset ? "pl-4 text-sm" : ""}`}
    >
      <dt className="min-w-0">
        {label}
        {note ? <span className="block text-[0.8125rem] font-normal text-smoke">{note}</span> : null}
      </dt>
      <dd className={`num flex-none ${shown < 0 && !total && !grand ? "text-bone-dim" : ""}`}>{amount}</dd>
    </div>
  );
}

/** A line with words on the right in place of an amount. */
export function TextRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-bone-dim">
      <dt className="min-w-0">{label}</dt>
      <dd className="num flex-none">{value}</dd>
    </div>
  );
}
