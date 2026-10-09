import type { ReactNode } from "react";

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <h1 className="display text-4xl text-white">{title}</h1>
      {action}
    </header>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="text-bone-dim">{label}</p>;
}
