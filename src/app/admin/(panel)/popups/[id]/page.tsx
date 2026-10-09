import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { DeletePopupForm, PopupEditor } from "@/components/admin/popup-form";
import { getDb } from "@/db";
import { listUsableDiscounts } from "@/db/queries/admin-discounts";
import { getPopup } from "@/db/queries/popups";
import { toPopupCode } from "@/lib/admin/popup-codes";
import { requireAdmin } from "@/lib/admin/session";
import { whyHidden } from "@/lib/popups";
import { POPUP_KINDS } from "@/lib/popups/shape";

export const metadata: Metadata = { title: "Pop-up" };

type Props = PageProps<"/admin/popups/[id]">;

export default function PopupPage({ params, searchParams }: Props) {
  return (
    <>
      <Link href="/admin/popups" className="link text-sm text-smoke">
        All pop-ups
      </Link>
      <Suspense fallback={<Loading />}>
        <Popup params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Popup({ params, searchParams }: Props) {
  await requireAdmin();
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const popup = await getPopup(db, id);
  if (!popup) notFound();
  const codes = (await listUsableDiscounts(db)).map(toPopupCode);
  const hidden = popup.isEnabled ? whyHidden(popup) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={popup.name}
        action={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tag tag-mute">{POPUP_KINDS[popup.kind].name}</span>
            {hidden ? (
              <span className="tag tag-warn">Not showing</span>
            ) : popup.isEnabled ? (
              <span className="tag tag-good">On</span>
            ) : (
              <span className="tag tag-mute">Off</span>
            )}
          </span>
        }
      />

      {created ? (
        <p role="status" className="panel -mt-2 px-4 py-3 text-sm">
          Pop-up created.{popup.isEnabled && !hidden ? " It's on the store now." : ""}
        </p>
      ) : null}
      {hidden ? (
        <p role="status" className="notice -mt-2 text-sm">
          This pop-up is switched on but isn&apos;t showing. {hidden}
        </p>
      ) : null}

      <PopupEditor
        id={popup.id}
        codes={codes}
        popup={{
          name: popup.name,
          kind: popup.kind,
          isEnabled: popup.isEnabled,
          eyebrow: popup.eyebrow ?? "",
          headline: popup.headline,
          body: popup.body,
          buttonLabel: popup.buttonLabel,
          buttonUrl: popup.buttonUrl ?? "",
          discountCodeId: popup.discountCodeId,
          sendsEmail: popup.sendsEmail,
          trigger: popup.trigger,
          delaySeconds: popup.delaySeconds,
          pages: popup.pages,
          showAgainDays: popup.showAgainDays,
        }}
      />

      <section className="panel flex max-w-3xl flex-col gap-2 p-5">
        <h2 className="text-sm font-semibold">Delete</h2>
        <p className="text-[0.8125rem] text-smoke">
          Takes it off the store for good. To stop it for now, switch it off instead.
        </p>
        <DeletePopupForm id={popup.id} />
      </section>
    </div>
  );
}
