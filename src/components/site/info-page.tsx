import type { ReactNode } from "react";
import { siteConfig, unfilledSiteConfig } from "@/lib/site-config";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

type InfoPageProps = {
  title: string;
  intro?: string;
  /** Policy pages show when they were last updated and a draft notice until the business details are filled in. */
  policy?: boolean;
  children: ReactNode;
};

/** Shared layout for help and policy pages. */
export function InfoPage({ title, intro, policy = false, children }: InfoPageProps) {
  const isDraft = policy && unfilledSiteConfig().length > 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-12 sm:px-10">
        <header className="flex flex-col items-center gap-4 border-b border-line pb-9 text-center">
          <h1 className="display text-[clamp(2.75rem,7vw,4.5rem)] text-white [text-shadow:0_0_42px_rgb(237_234_227/0.18)]">
            {title}
          </h1>
          {intro ? <p className="max-w-xl text-balance text-lg text-bone-dim">{intro}</p> : null}
          {policy ? (
            <p className="text-sm text-smoke">Last updated {siteConfig.policiesUpdated}</p>
          ) : null}
          {isDraft ? (
            <p className="rounded-field border border-accent/60 bg-accent/10 px-4 py-3 text-sm text-bone">
              Draft. Details shown in [brackets] still need to be filled in before the store
              opens.
            </p>
          ) : null}
        </header>
        <div className="prose-site pt-8">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

/** Shows an email as a mail link once it is real, and as plain text while it is a placeholder. */
export function Email({ address }: { address: string }) {
  if (address.startsWith("[")) return <span>{address}</span>;
  return <a href={`mailto:${address}`}>{address}</a>;
}
