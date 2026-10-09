import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { PopupOrder, PopupSwitch } from "@/components/admin/popup-form";
import { getDb } from "@/db";
import { listPopups } from "@/db/queries/popups";
import { requireAdmin } from "@/lib/admin/session";
import { discountSummary } from "@/lib/discounts/describe";
import { whyHidden } from "@/lib/popups";
import { POPUP_KINDS, POPUP_LIMITS, type PopupKind, describeTiming } from "@/lib/popups/shape";

export const metadata: Metadata = { title: "Pop-ups" };

type Props = PageProps<"/admin/popups">;

export default function PopupsPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader title="Pop-ups" />
      <Suspense fallback={<Loading />}>
        <Popups searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Popups({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const [{ deleted }, popups] = await Promise.all([searchParams, listPopups(getDb())]);
  const full = popups.length >= POPUP_LIMITS.count;
  const live = popups.filter((popup) => popup.isEnabled && whyHidden(popup) === null);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {deleted ? (
        <p role="status" className="panel px-4 py-3 text-sm">
          Pop-up deleted.
        </p>
      ) : null}

      <p className="text-bone-dim">
        A visitor sees one pop-up per visit at most: the first one in this list that is switched on and fits the
        page they are on. Pop-ups never open at checkout.
        {live.length > 1 ? " Use the arrows to choose which goes first." : ""}
      </p>

      {popups.length === 0 ? (
        <p className="panel px-5 py-6 text-bone-dim">No pop-ups yet. Start one below.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {popups.map((popup, index) => {
            const hidden = popup.isEnabled ? whyHidden(popup) : null;
            return (
              <li key={popup.id} className="panel flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
                {popups.length > 1 ? (
                  <PopupOrder id={popup.id} name={popup.name} first={index === 0} last={index === popups.length - 1} />
                ) : null}
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/popups/${popup.id}`} className="text-lg font-semibold text-white link">
                      {popup.name}
                    </Link>
                    <span className="tag tag-mute">{POPUP_KINDS[popup.kind].name}</span>
                    {hidden ? (
                      <span className="tag tag-warn">Not showing</span>
                    ) : popup.isEnabled ? (
                      <span className="tag tag-good">On</span>
                    ) : (
                      <span className="tag tag-mute">Off</span>
                    )}
                  </div>
                  <p className="text-sm text-bone-dim">
                    “{popup.headline}”. {describeTiming(popup)}.
                  </p>
                  <p className="text-sm text-smoke">
                    {popup.discount
                      ? `Gives ${popup.discount.code} (${discountSummary(popup.discount)}${popup.discount.firstOrderOnly ? ", first order only" : ""}).`
                      : popup.kind === "MESSAGE"
                        ? `Button goes to ${popup.buttonUrl ?? "nowhere yet"}.`
                        : "No code."}
                    {popup.kind === "EMAIL"
                      ? ` ${popup.signups.toLocaleString("en-US")} new ${popup.signups === 1 ? "sign-up" : "sign-ups"}.`
                      : ""}
                  </p>
                  {hidden ? <p className="text-sm text-ember">{hidden}</p> : null}
                </div>
                <div className="flex flex-none items-center gap-4">
                  <PopupSwitch id={popup.id} name={popup.name} isEnabled={popup.isEnabled} />
                  <Link href={`/admin/popups/${popup.id}`} className="btn btn-glass btn-sm">
                    Edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">Add a pop-up</h2>
        {full ? (
          <p className="text-sm text-smoke">
            The store keeps up to {POPUP_LIMITS.count} pop-ups. Delete one you no longer use to add another.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {(Object.entries(POPUP_KINDS) as [PopupKind, { name: string; about: string }][]).map(([kind, text]) => (
              <li key={kind}>
                <Link
                  href={`/admin/popups/new?kind=${kind}`}
                  className="panel flex h-full flex-col gap-1.5 p-4 transition-colors hover:border-line-strong hover:bg-white/[0.04]"
                >
                  <span className="font-semibold text-white">{text.name}</span>
                  <span className="text-sm text-bone-dim">{text.about}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
