# The relay: getting orders to the printer before its own connection exists

Printmood has no way yet for this site to hand it an order directly. It does connect
to ordinary shop platforms. So until its own connection is ready, this site passes
orders through a small WooCommerce shop (the "relay store") that Printmood is
connected to:

```
voidszn.com  --copies products and paid orders-->  relay store (WooCommerce)  <--connected-->  Printmood
voidszn.com  <--------reads "shipped" and tracking--------  relay store
```

Customers never see the relay store. It is plumbing.

Nothing is sent anywhere until the three settings below are in place. Until then
orders are placed with the printer by hand, as before.

## Where it stands (October 9, 2026)

The relay shop is live at `voidsznrelay.wpcomstaging.com` (WordPress.com, Personal
plan, billed monthly), the three settings are in Vercel, and Printmood is connected to
it: Printmood does offer WooCommerce under Stores, although its help centre had no
guide for it. Still to do: the test orders in step 7, then switching on "Send paid
orders by themselves".

## What it does

- **Products.** Each product on sale is copied to the relay store as one item with a
  Color and a Size option, and every size on sale as a variation under the same SKU
  it has here. New and changed products are copied every half hour, or at once with
  the button on the Relay screen. Nothing is ever deleted over there, because the
  printer's design set-up hangs off those items.
- **Orders.** A paid order is placed in the relay store with the same items, the
  shipping address and what was charged. It can be sent by hand from the order's page
  ("Send to the printer"). With "Send paid orders by themselves" switched on, orders
  paid from that moment on go without anyone touching them, once the time a customer
  has to cancel (`siteConfig.orders.cancelWindow`, 1 hour) is up. Switching it on never
  sends the backlog: orders already waiting stay until a person sends them. A
  part-refunded order is never sent by itself either.
- **Tracking.** Every half hour the site asks the relay store about orders that are
  with the printer. When one is complete and has a tracking number, the order is
  marked as shipped here and the customer gets the shipping email.
- **Changes.** Cancelling an order here, refunding it in full, or marking it as placed
  with the printer by hand takes its copy back out of the relay store, and a corrected
  address is passed on. If the printer already had the copy, the order is flagged,
  because printing may have started.

## Setting it up

1. **Make the relay shop.** Any WordPress host with the WooCommerce plugin, on an
   address with HTTPS. On WordPress.com: keep the free address (a subdomain of
   voidszn.com can't be connected there while the main domain points at Vercel), take
   any paid plan (plugins need one; Personal is enough), and install WooCommerce from
   Plugins. Once plugins are installed the address ends in `.wpcomstaging.com`: use
   the one in the browser's address bar. In WooCommerce, Settings, Site visibility,
   choose **Coming soon**, so nobody can buy from it directly (the relay still works
   with it on). In WordPress, Settings, Permalinks, pick anything but Plain.
2. **Turn off the shop's customer emails** (WooCommerce, Settings, Emails). The site
   already puts the store's own email address on every order it sends, not the
   customer's, so the shop has nobody to write to. Switching them off stops the noise.
3. **Make its keys.** WooCommerce, Settings, Advanced, REST API, Add key. Permissions:
   **Read/Write**. Copy the consumer key (`ck_...`) and consumer secret (`cs_...`).
4. **Put three settings in Vercel**, then redeploy:
   - `RELAY_WOO_URL`: the shop's address with `https://` in front and no slash at the
     end, like `https://voidsznrelay.wpcomstaging.com`
   - `RELAY_WOO_KEY`: the consumer key
   - `RELAY_WOO_SECRET`: the consumer secret (mark it Sensitive)

   The Relay screen then says **Connected**, and `/api/health` shows `"relay":"on"`.
5. **Copy your products** with the button on the Relay screen.
6. **Connect Printmood to the relay shop** in Printmood's dashboard, sync its
   products there, and attach each design to its product. Printmood matches sizes and
   colors by their names, so keep the names here the same as Printmood's.
7. **Send test orders** by hand and watch them at Printmood: send one, cancel one
   from this site, change the address on one. Check what Printmood charges and when.
   Only then switch on "Send paid orders by themselves".

## What reaches the relay store, and what doesn't

Sent: the customer's name, shipping address and phone number (the printer needs these
to ship), the items, and the amounts charged.

Never sent: the customer's email address, anything about their card, or their order
history. The Privacy page already says shipping details go to the print partner.

## How one order is kept to one copy

Placing an order twice would mean printing and paying for it twice, so:

- A send takes the order for itself first (`orders.relay_claimed_at`). A second send
  at the same moment gets nothing.
- The copy is made **unpaid** ("pending"), which the printer ignores. Its id is written
  on our order, and only then is it released ("processing").
- WooCommerce has no "don't repeat this" key. If the reply to making the copy is lost,
  the send keeps its claim for 10 minutes, and the next try first looks through the
  shop's recent orders for one carrying our order number (`_voidszn_order`). It
  adopts that one and bins any stray extra that was never released.
- A copy is checked line by line against the order before it is released, whether it
  was just made or left by an earlier try. One that doesn't match is binned.
- An item is only matched to a variation under the relay store's copy of its own
  product. A SKU alone isn't trusted, because renaming a product here leaves its old
  SKUs behind over there.
- A copy is only released for an order that is still paid and waiting, and with the
  address as it stands at that moment. If the order is cancelled, refunded or placed by
  hand while its send is running, the send takes its own copy back.
- If the search for an earlier copy can't see everything (more than 2,000 orders in
  the shop since the first try), nothing is made and the order is flagged.
- A cut-off send is always finished by the timed job, even when sending by itself is
  switched off, for as long as it takes.
- An order the shop refuses outright is tried 6 times, then left for a person. An
  order that failed, or was cancelled on the printer's side, is never sent again by
  itself. A person presses "Send it again", which takes up the old copy if someone has
  brought it back in the shop, so there are never two.
- The id of a copy is only trusted when the copy itself names our order. If the relay
  store is ever swapped for another shop, nothing is shipped from, changed or cancelled
  on the strength of a matching number.

## When something goes wrong

Every problem is written on the order and shows under "Need a look" on the Relay
screen. One that needs a person also puts the order in the Orders list's "Needs
attention" view. (A single "didn't answer" does not: it is retried by itself, and
only flagged after the third in a row.)

| It says | What to do |
| --- | --- |
| The relay store doesn't have (item) | Press "Copy new and changed products" on the Relay screen, then send the order again. |
| The relay store refused the keys | Make a new Read/Write key in the shop and put it in Vercel. |
| The relay store didn't answer | Its host is down or slow. It is tried again by itself. |
| The printer has finished this order, but no tracking number came with it | Find the tracking in Printmood, then mark the order as shipped by hand. |
| This order has been with the printer for more than 10 days | Look at it in Printmood. The connection between Printmood and the shop may have dropped. |
| Order N in the relay store is not this order | The relay store was changed for another one. Check Printmood before sending anything again. |
| This order was changed while it was being sent | It was cancelled or refunded mid-send and its copy was taken back. Check Printmood in case printing had started. |
| This order was marked cancelled / was deleted in the relay store | It is not being made. Send it again, or refund the customer. |
| It could NOT be cancelled in the relay store | Cancel it in the shop by hand so it isn't printed. |

## What was checked, and what was not

Checked against a real WooCommerce 11.2 shop run on the build machine
(`npm run test:relay`, 26 checks, plus a browser run of the whole flow):

- Products and variations are made, found by SKU and updated without duplicates.
- An order arrives once, paid, with the right items, totals and address, even when
  two sends race or a reply is lost.
- Cancelling an order at any moment during a send leaves no copy for the printer.
- Tracking is read from the "shipment tracking" field most plugins use, from fields
  named like `_tracking_number`, or from a note left on the order. A record id or a
  phone number is not mistaken for one.
- WooCommerce quirks the code works around: an order line naming an unknown SKU is
  silently dropped; a product whose photo can't be fetched is refused whole; the
  order list ignores a filter by custom field.

Not checked, because it needs a Printmood account connected to a real shop:

1. (Settled: Printmood does connect to WooCommerce.)
2. That Printmood leaves an unpaid ("pending") order alone and picks it up when it
   turns "processing". The one-copy design leans on this: a copy is made unpaid first
   so that a stray one can be binned unseen. If Printmood takes orders the moment they
   are made, tell the developer before switching on sending by itself.
3. (Settled on live orders, October 9, 2026: Printmood does follow the shop. An order
   cancelled here showed as Canceled in Printmood a few minutes later, and a changed
   address came through. An order Printmood shows as "Need Action" is paused until it
   is confirmed there.)
4. Where Printmood writes the tracking number. If it uses a field this code doesn't
   read, shipped orders are flagged "no tracking number came with it" and nothing is
   lost; `src/lib/relay/tracking.ts` then needs that field added.
5. Whether Printmood needs anything on the order this code doesn't send.
6. The newer of WooCommerce's two ways of storing orders is what the full test ran on
   (it is the default for a new shop). Each call was also tried on the older one.

The first real test orders (step 7) answer the first five. Send one, cancel one, and
change the address on one.

## For the developer

- `src/lib/relay/woo.ts`: the WooCommerce REST calls. Nothing else knows it is WooCommerce.
- `src/lib/relay/products.ts`, `orders.ts`: what is sent and when. `tracking.ts`: reading tracking.
- `src/db/queries/relay.ts`: claims, lists and the overview.
- `/admin/relay`: the screen. The timed job (`/api/cron/relay`, every half hour) runs
  `sendWaitingOrders`, `followRelayedOrders` and `syncCatalogToRelay`, each with its
  own share of the minute. It runs at most once every 4 minutes however often it is
  called. Set `CRON_SECRET` in Vercel and only Vercel's timer can call it at all.
- A relayed order has `fulfillment_provider = 'PRINTMOOD'` and the shop's order id in
  `external_order_id`. When Printmood's own connection arrives, it replaces `woo.ts`
  and the rest stays.
