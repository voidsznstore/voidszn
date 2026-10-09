import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteDiscountForm, DiscountEditor } from "@/components/admin/discount-form";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { DISCOUNT_STATE_LABELS, discountState, getDiscount } from "@/db/queries/admin-discounts";
import { formatDateTime, timeZoneName, toLocalInput } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = { title: "Discount code" };

type Props = PageProps<"/admin/discounts/[id]">;

export default function DiscountPage({ params, searchParams }: Props) {
  return (
    <>
      <Link href="/admin/discounts" className="link text-sm text-smoke">
        All discounts
      </Link>
      <Suspense fallback={<Loading />}>
        <Discount params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

async function Discount({ params, searchParams }: Props) {
  await requireAdmin();
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getDiscount(getDb(), id);
  if (!detail) notFound();
  const { discount, totals, recent } = detail;
  const state = discountState(discount);
  const shareLink = `${siteConfig.url}/?code=${discount.code}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={discount.code}
        action={
          <span className={state === "active" ? "tag tag-good" : state === "scheduled" ? "tag tag-warn" : "tag tag-mute"}>
            {DISCOUNT_STATE_LABELS[state]}
          </span>
        }
      />

      {created ? (
        <p role="status" className="panel -mt-2 px-4 py-3 text-sm">
          Code created. It works at checkout now{state === "scheduled" ? ", once its start date arrives" : ""}.
        </p>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-3">
        {[
          ["Times used", `${discount.usedCount}${discount.maxUses !== null ? ` of ${discount.maxUses}` : ""}`],
          ["Taken off orders", formatMoney(totals.discountCents)],
          ["Sales with this code", formatMoney(totals.salesCents)],
        ].map(([label, value]) => (
          <li key={label} className="panel flex flex-col gap-1 p-4">
            <span className="label text-smoke">{label}</span>
            <span className="num text-2xl font-semibold text-white">{value}</span>
          </li>
        ))}
      </ul>

      <section className="panel flex flex-col gap-2 p-5">
        <h2 className="text-sm font-semibold">Link that applies it</h2>
        <p className="break-all font-mono text-sm text-bone-dim">{shareLink}</p>
        <p className="text-[0.8125rem] text-smoke">
          Anyone who opens this link gets the code added for them. Adding{" "}
          <span className="font-mono">?code={discount.code}</span> to any page of the store does the same.
          Campaigns do this by themselves when you pick the code.
        </p>
      </section>

      <DiscountEditor
        timeZoneName={timeZoneName()}
        discount={{
          id: discount.id,
          code: discount.code,
          type: discount.type,
          percent: discount.type === "PERCENTAGE" ? String(discount.value) : "10",
          amount: discount.type === "FIXED" ? dollars(discount.value) : "5",
          hasMinimum: discount.minOrderCents > 0,
          minimum: discount.minOrderCents > 0 ? dollars(discount.minOrderCents) : "",
          hasLimit: discount.maxUses !== null,
          maxUses: discount.maxUses !== null ? String(discount.maxUses) : "",
          oncePerCustomer: discount.perCustomerLimit !== null,
          startsAt: toLocalInput(discount.startsAt),
          hasEnd: discount.expiresAt !== null,
          expiresAt: toLocalInput(discount.expiresAt),
          isActive: discount.isActive,
          note: discount.note ?? "",
        }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="label text-smoke">Orders that used it</h2>
        {recent.length === 0 ? (
          <p className="text-bone-dim">None yet.</p>
        ) : (
          <div className="panel overflow-x-auto px-5 py-1">
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
              <thead>
                <tr className="label border-b border-line text-smoke">
                  <th scope="col" className="py-3 pr-4 font-medium">Order</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Placed</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Customer</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Taken off</th>
                  <th scope="col" className="py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((order) => (
                  <tr key={order.orderNumber} className="border-b border-line">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/orders/${order.orderNumber}`}
                        className="inline-flex min-h-11 items-center font-mono font-semibold text-white underline-offset-4 hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-bone-dim">{formatDateTime(order.createdAt)}</td>
                    <td className="py-2 pr-4">{order.email}</td>
                    <td className="num py-2 pr-4">{formatMoney(order.discountCents)}</td>
                    <td className="num py-2">{formatMoney(order.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-t border-line pt-5">
        <DeleteDiscountForm id={discount.id} />
        <p className="mt-1 text-[0.8125rem] text-smoke">
          Orders that used the code keep its name and what it took off.
        </p>
      </section>
    </div>
  );
}
