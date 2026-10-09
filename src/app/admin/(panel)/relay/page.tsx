import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { AutoSendSwitch, CheckShippedButton, CopyProductsButton, SendWaitingButton } from "@/components/admin/relay-forms";
import { getDb } from "@/db";
import { countProductsToSync, relayOverview } from "@/db/queries/relay";
import { requireAdmin } from "@/lib/admin/session";
import { siteConfig } from "@/lib/site-config";
import { getRelaySettings } from "@/lib/relay/settings";
import { checkRelayStore, isRelayConfigured, relayStoreUrl } from "@/lib/relay/woo";

export const metadata: Metadata = { title: "Relay" };

/** Copying a catalog or sending a batch of orders can take most of a minute. */
export const maxDuration = 60;

export default function RelayPage() {
  return (
    <>
      <PageHeader title="Relay" />
      <Suspense fallback={<Loading />}>
        <Relay />
      </Suspense>
    </>
  );
}

const panel = "panel flex flex-col gap-4 p-5";
const heading = "text-xl font-semibold text-white";
const small = "text-[0.8125rem] text-smoke";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="well flex flex-col gap-1 px-4 py-3">
      <span className="label text-smoke">{label}</span>
      <span className="num text-2xl font-semibold text-white">{value.toLocaleString("en-US")}</span>
    </li>
  );
}

async function Relay() {
  await requireAdmin();
  const db = getDb();
  const configured = isRelayConfigured();
  const [overview, settings, toCopy, store] = [
    await relayOverview(db),
    await getRelaySettings(db),
    await countProductsToSync(db),
    configured ? await checkRelayStore().catch(() => ({ ok: false as const, reason: "The relay store didn't answer." })) : null,
  ];
  const ready = store?.ok === true;
  const neverCopied = overview.products.copied === 0;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <p className="text-bone-dim">
        Until the printer&apos;s own connection is ready, orders reach it through a small WooCommerce shop that the
        printer is connected to. This screen copies your products and paid orders into that shop, and brings the
        tracking number back when the printer ships.
      </p>

      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={heading}>Connection</h2>
          {ready ? (
            <span className="tag tag-good">Connected</span>
          ) : configured ? (
            <span className="tag tag-warn">Not working</span>
          ) : (
            <span className="tag tag-mute">Not set up</span>
          )}
        </div>
        {ready ? (
          <p className="text-bone-dim">
            Connected to <span className="font-mono text-bone">{relayStoreUrl()}</span>
            {store.version ? ` (WooCommerce ${store.version})` : ""}.
          </p>
        ) : configured ? (
          <p className="text-ember">
            {relayStoreUrl()} is set as the relay store, but it can&apos;t be used: {store && !store.ok ? store.reason : ""}
          </p>
        ) : (
          <p className="text-bone-dim">
            No relay store is connected yet, so nothing is sent anywhere. Orders are placed with the printer by hand,
            as before. The steps are at the bottom of this page.
          </p>
        )}
      </section>

      <section className={panel}>
        <h2 className={heading}>Products</h2>
        <p className="text-bone-dim">
          {overview.products.copied.toLocaleString("en-US")} of {overview.products.active.toLocaleString("en-US")}{" "}
          products on sale are in the relay store.
          {toCopy > 0 ? ` ${toCopy} ${toCopy === 1 ? "is" : "are"} new or changed and waiting to be copied.` : ""}
        </p>
        <CopyProductsButton disabled={!ready} first={neverCopied} />
        <p className={small}>
          Each product goes over with every color and size under the same SKU it has here. New and changed products
          are also copied by themselves every half hour. After copying, open the printer&apos;s dashboard and attach
          each design to its product there: that part can only be done on the printer&apos;s side.
        </p>
        {overview.productProblems.length > 0 ? (
          <ul className="flex flex-col gap-2 border-t border-line pt-4">
            {overview.productProblems.map((product) => (
              <li key={product.id} className="text-sm">
                <Link href={`/admin/products/${product.id}`} className="font-semibold link">
                  {product.name}
                </Link>
                <span className="text-ember"> {product.error}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={panel}>
        <h2 className={heading}>Orders</h2>
        <ul className="grid gap-3 sm:grid-cols-4">
          <Stat label="Waiting to send" value={overview.orders.waiting} />
          <Stat label="With the printer" value={overview.orders.withPrinter} />
          <Stat label="Shipped" value={overview.orders.shipped} />
          <Stat label="Failed" value={overview.orders.failed} />
        </ul>
        <div className="border-t border-line pt-4">
          <AutoSendSwitch on={settings.autoSend} disabled={!ready && !settings.autoSend} />
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <SendWaitingButton disabled={!ready || overview.orders.waiting === 0} />
          <CheckShippedButton disabled={!ready || overview.orders.withPrinter === 0} />
          <p className={small}>
            “Send waiting orders now” sends every paid order that hasn&apos;t gone yet, whenever it was paid. Shipped
            orders are checked for every half hour. When the printer adds a tracking number, the order is marked as
            shipped here and the customer gets the shipping email.
          </p>
        </div>
        {overview.problems.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <h3 className="font-semibold text-white">Need a look</h3>
            <ul className="flex flex-col gap-2">
              {overview.problems.map((problem) => (
                <li key={problem.orderNumber} className="text-sm">
                  <Link href={`/admin/orders/${problem.orderNumber}`} className="font-mono font-semibold link">
                    {problem.orderNumber}
                  </Link>
                  <span className="text-ember"> {problem.error}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <details className="panel p-5" open={!configured}>
        <summary className="flex min-h-11 cursor-pointer items-center text-xl font-semibold text-white">
          Setting it up
        </summary>
        <ol className="flex list-decimal flex-col gap-3 pl-5 pt-3 text-bone-dim">
          <li>
            <strong className="text-bone">Make the relay shop.</strong> Any WordPress host with WooCommerce on it, on
            an address with HTTPS. On WordPress.com the free address is fine. Put the shop in <em>Coming soon</em>{" "}
            mode so nobody can buy from it directly.
          </li>
          <li>
            <strong className="text-bone">Make its keys.</strong> In the shop: WooCommerce, Settings, Advanced, REST
            API, Add key. Permissions: Read/Write. Also check Settings, Permalinks is anything but Plain.
          </li>
          <li>
            <strong className="text-bone">Put them in Vercel</strong> as <span className="font-mono">RELAY_WOO_URL</span>{" "}
            (the shop&apos;s address, starting with https://), <span className="font-mono">RELAY_WOO_KEY</span> and{" "}
            <span className="font-mono">RELAY_WOO_SECRET</span>, then redeploy. This page then says Connected.
          </li>
          <li>
            <strong className="text-bone">Copy your products</strong> with the button above.
          </li>
          <li>
            <strong className="text-bone">Connect the printer to the relay shop</strong> in the printer&apos;s
            dashboard, sync its products there and attach each design.
          </li>
          <li>
            <strong className="text-bone">Send one test order</strong> from its order page and watch it arrive at the
            printer. When you&apos;re happy, switch on “Send paid orders by themselves”. Orders then go once the
            time a customer has to cancel ({siteConfig.orders.cancelWindow}) is up.
          </li>
        </ol>
        <p className={`${small} pt-3`}>The full guide, including what to check first, is in docs/relay.md.</p>
      </details>
    </div>
  );
}
