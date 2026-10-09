import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CustomerForm, DeleteCustomerForm } from "@/components/admin/customer-form";
import { Loading } from "@/components/admin/page-header";
import { getDb } from "@/db";
import { getCustomer } from "@/db/queries/admin-customers";
import { formatDate, formatDateTime, statusLabel } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Customer" };

type Props = PageProps<"/admin/customers/[id]">;

export default function CustomerPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Customer params={params} />
    </Suspense>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const panel = "flex flex-col gap-4 border border-line bg-ash-soft p-5";
const heading = "text-lg font-semibold text-white";

async function Customer({ params }: Pick<Props, "params">) {
  await requireAdmin();
  const { id } = await params;
  const detail = UUID.test(id) ? await getCustomer(getDb(), id) : null;
  if (!detail) notFound();

  const { customer, orders, spentCents, optedOutAt } = detail;
  const address = customer.defaultAddress;
  const marketing = optedOutAt
    ? `Unsubscribed ${formatDate(optedOutAt)}`
    : customer.acceptsEmail
      ? "Gets marketing emails"
      : "No marketing emails";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/admin/customers" className="text-sm text-smoke underline underline-offset-4 hover:text-bone">
          All customers
        </Link>
        <h1 className="display text-4xl text-white">{customer.name ?? customer.email}</h1>
        <p className="text-sm text-smoke">
          Customer since {formatDate(customer.createdAt)} · {marketing}
        </p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              ["Orders", String(orders.length)],
              ["Spent", formatMoney(spentCents)],
              ["Last order", orders[0] ? formatDate(orders[0].createdAt) : "None"],
            ].map(([label, value]) => (
              <li key={label} className="flex flex-col gap-1 border border-line bg-ash-soft p-4">
                <span className="label text-xs text-smoke">{label}</span>
                <span className="font-mono text-xl text-white">{value}</span>
              </li>
            ))}
          </ul>

          <section className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={heading}>Orders</h2>
              <Link href={`/admin/orders/new?customer=${customer.id}`} className="btn btn-outline min-h-11 px-5">
                Add an order for them
              </Link>
            </div>
            {orders.length === 0 ? (
              <p className="text-bone-dim">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="label border-b border-line text-xs text-smoke">
                      <th scope="col" className="py-3 pr-4 font-medium">Order</th>
                      <th scope="col" className="py-3 pr-4 font-medium">Placed</th>
                      <th scope="col" className="py-3 pr-4 font-medium">Status</th>
                      <th scope="col" className="py-3 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.orderNumber} className="border-b border-line last:border-b-0">
                        <td className="py-2 pr-4">
                          <Link
                            href={`/admin/orders/${order.orderNumber}`}
                            className="inline-flex min-h-11 items-center font-mono font-semibold text-white underline-offset-4 hover:underline"
                          >
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-bone-dim">{formatDateTime(order.createdAt)}</td>
                        <td className="py-2 pr-4">
                          <span className="label text-xs">{statusLabel(order.status)}</span>
                        </td>
                        <td className="py-2 font-mono">
                          {formatMoney(order.totalCents)}
                          {order.refundedCents > 0 ? (
                            <span className="block text-xs text-smoke">
                              {formatMoney(order.refundedCents)} refunded
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className={panel}>
            <h2 className={heading}>Details</h2>
            <p className="text-bone-dim">
              <a href={`mailto:${customer.email}`} className="underline underline-offset-4">
                {customer.email}
              </a>
            </p>
            {/* Keyed on the customer, not on what is saved: a re-made form would lose its "Saved." */}
            <CustomerForm
              key={customer.id}
              customer={{
                id: customer.id,
                name: customer.name ?? "",
                email: customer.email,
                phone: customer.phone ?? "",
                line1: address?.line1 ?? "",
                line2: address?.line2 ?? "",
                city: address?.city ?? "",
                state: address?.state ?? "",
                postalCode: address?.postalCode ?? "",
                acceptsEmail: customer.acceptsEmail && !optedOutAt,
                notes: customer.notes ?? "",
              }}
              unsubscribedOn={optedOutAt ? formatDate(optedOutAt) : null}
            />
          </section>

          {orders.length === 0 ? (
            <section className={panel}>
              <DeleteCustomerForm id={customer.id} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
