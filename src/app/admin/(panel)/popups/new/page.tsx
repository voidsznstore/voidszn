import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { PopupEditor } from "@/components/admin/popup-form";
import { getDb } from "@/db";
import { listUsableDiscounts } from "@/db/queries/admin-discounts";
import { toPopupCode } from "@/lib/admin/popup-codes";
import { requireAdmin } from "@/lib/admin/session";
import { POPUP_KINDS, POPUP_STARTERS, isPopupKind } from "@/lib/popups/shape";

export const metadata: Metadata = { title: "New pop-up" };

type Props = PageProps<"/admin/popups/new">;

export default function NewPopupPage({ searchParams }: Props) {
  return (
    <>
      <Link href="/admin/popups" className="link text-sm text-smoke">
        All pop-ups
      </Link>
      <Suspense fallback={<Loading />}>
        <NewPopup searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewPopup({ searchParams }: Pick<Props, "searchParams">) {
  await requireAdmin();
  const { kind: asked } = await searchParams;
  const kind = isPopupKind(asked) ? asked : "EMAIL";
  const codes = (await listUsableDiscounts(getDb())).map(toPopupCode);
  // A welcome sign-up starts on the store's first-order code, if it has one.
  const welcome = kind === "EMAIL" ? codes.find((code) => code.firstOrderOnly) : undefined;

  return (
    <>
      <PageHeader title={`New ${POPUP_KINDS[kind].name.toLowerCase()}`} />
      <PopupEditor popup={{ ...POPUP_STARTERS[kind], discountCodeId: welcome?.id ?? null }} codes={codes} />
    </>
  );
}
