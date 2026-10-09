# Backend notes

Things to build or remember when the backend and admin panel are started. Add to this
file whenever a decision is made that the backend has to honor.

## Categories: sort and filter by category (requested by the owner)

The admin must be able to sort and filter by category everywhere products appear. Built:

- **Admin product list** (`/admin/products`): filter by any category (product type or
  interest), sort by category, and each product's type and interests shown as columns.
- **Admin orders** (`/admin/orders`): filter to orders containing a product from a
  category.
- **Sales** (`/admin/sales`): what sold by product type and by interest over a chosen
  period. Each category links to its orders.
- **Category management** (`/admin/categories`): create, rename, hide and delete
  categories of both kinds. Drag (or use the arrow buttons) to reorder categories
  (`categories.sort_order`) and to reorder products inside a category
  (`product_categories.sort_order`).
- **Product form:** exactly one product type and any number of interests.
- **Storefront:** category pages at `/collections/[slug]`, in the category's own order.

"Best Sellers" and "Just In" are not categories. They are automatic lists: best sellers
ranked from paid order items over the last 90 days (newest fills in until there are
sales), just in ordered by `products.created_at`.

## The admin

- **Sign-in:** `/admin/login`. Sessions are random tokens in an httpOnly cookie, stored
  hashed in `admin_sessions`. Passwords are hashed with scrypt. Repeated bad sign-ins
  are slowed down (`admin_login_attempts`).
- **Two-step sign-in is required.** After the password, sign-in asks for a six-digit code
  from an authenticator app (Google Authenticator or any other; standard TOTP). A new
  account is sent to set the app up before the admin opens at all. Ten one-time recovery
  codes are shown at set-up, stored hashed, for when the phone is not to hand. The
  Security screen (`/admin/security`) makes new recovery codes or moves to a new phone;
  both need a current code. A code works once, and five wrong ones end the attempt.
- **Locked out completely** (phone and recovery codes both gone): add a migration that
  runs `UPDATE admin_users SET totp_secret = NULL, totp_pending_secret = NULL,
  totp_enabled_at = NULL, totp_last_step = NULL WHERE email = '...'`. The next sign-in
  with the password goes straight to set-up again.
- **First account:** created through a one-time link (`/admin/setup?code=...`). Only the
  hash of the code is in the database. The link dies once an admin exists or after 14
  days. To issue a new one, add a migration like `drizzle/0002_admin_setup_link.sql`
  with a fresh hash.
- **Password:** "Forgot your password?" on the sign-in page emails a link that works
  once, for an hour (`src/lib/admin/password-reset.ts`; only the link's hash is
  stored). It needs email to be set up. A reset signs every browser out and does not
  get around the authenticator app. The Security screen changes the password for
  someone who knows the current one.
- **Signing out reloads the browser** on purpose, so no admin page stays in memory.
- **Every admin page and action calls `requireAdmin()`.** The request proxy
  (`src/proxy.ts`) only checks that a cookie is present, as a fast first filter.
- **Products:** one price per product with optional per-size prices. Every color and
  size pair is a variant row. Photos are shrunk in the browser, uploaded through
  `/api/admin/uploads` and stored in R2 (`src/lib/storage.ts`).
- **Team** (`/admin/team`): everyone shares one dashboard and one set of data. The
  first account (`role = OWNER`) is the **master account**: voidsznstore@gmail.com,
  Henry Palacios. When the owner says "my dashboard" he means that account. It alone
  can invite or remove people, change profit shares, correct balances, settle
  payouts and edit the stand-in figures; those actions call `requireMaster()`.
  Everyone else is `STAFF` and can do everything else.
  - Inviting (`src/lib/admin/invites.ts`) makes the account straight away with a
    password that can't be typed (`!invited`) and emails a link to `/admin/join`.
    The link works once, for a week, and only its hash is stored. The timed job
    sends any invitation still waiting, which is how the two partner accounts added
    by migration 0009 got theirs.
  - "Remove access" sets `admin_users.disabled_at`. That signs the person out
    everywhere on their next request and blocks sign-in and password reset.
- **Accounting** (`/admin/accounting`): nothing is stored as a total. The books are
  rebuilt from the orders and the costs every time (`src/lib/accounting/ledger.ts`,
  loaded by `src/db/queries/accounting.ts`), by day in the store's time zone.
  - Money in is what customers paid. Money out is refunds, sales tax owed, the cost
    of goods, card fees and expenses. Profit is one less the other.
  - Cost of goods: the printer's bill typed on the order (`orders.cost_cents`), or
    else each line's `unit_cost_cents`, copied from the product when the order is
    saved. Saving a cost on a product fills it in on past orders that had none.
  - Card fee: the real one from Square once the timed job has it
    (`orders.processing_fee_cents`), the stand-in rate until then.
  - Expenses are one-off (`expenses`) or repeating (`recurring_costs`, counted on
    their day each month or year with nothing to enter).
  - Sales tax and the tax set-aside: see `docs/tax-notes.md`.
  - An order added by hand and then cancelled is left out of the books.
  - Anyone can add an expense or a subscription. Removing or stopping one raises
    every balance, so that is for the master account.
  - Known gap: a refund or chargeback made in Square's own dashboard, not from the
    order page here, never reaches the books.
- **Payouts** (`/admin/payouts`, `src/lib/accounting/payouts.ts`,
  `src/db/queries/payouts.ts`): a partner's balance is their share of all profit to
  date, plus or minus corrections, less everything cashed out. Cashing out takes
  the whole balance, so it returns to $0.
  - Shares are rows in `profit_shares` with a start day. A change adds a row, so
    earlier profit keeps its old split. Shares can't total more than 100%.
  - The amount is always worked out on the server inside an advisory lock. The
    browser sends nothing but the click.
  - A payout is REQUESTED, then SENT or CANCELLED by the master account. Each keeps
    a copy of the sums behind it (`receipt`).
  - Nobody can cash out while a paid order has no cost recorded, because that
    order would be counted as pure profit.
  - Because profit is recomputed, a refund or cost that arrives after a cash-out
    takes the balance below zero. Available stays $0 until new profit covers it.
  - Money is sent by hand for now (`method = "manual"`); the partner says where in
    `admin_users.payout_handle`. Never store a card or bank number. A card payout
    service would plug in at `requestPayout` and the "Where it goes" panel.
- **Banner** (`/admin/banner`): the moving strip under the store's header. The owner
  sets up to six lines, the color of the words, and whether it shows at all. It is one
  row in `settings` (`store.banner`), read through `src/lib/banner` (cached, cleared by
  `BANNER_TAG` on save). `BannerStrip` draws it on the store and in the admin preview.
- **Orders:** worked by hand for now: mark as sent to the printer, then shipped with
  tracking, then delivered. Every change is written to the order's history with who
  did it.
- **Orders added by hand** (Orders, "Add order"; `src/db/queries/admin-manual-orders.ts`):
  for sales agreed outside the site. Items are catalog products (price filled in, can
  be changed) or custom items typed in. Shipped or pickup. Either already paid, with
  how it was paid recorded in `orders.payment_provider`, or not paid yet (status
  `PENDING`, "Not paid" tab) until "Mark as paid". Nothing is charged by the site, so
  there is no Refund box on these; money goes back the way it came. No sales tax is
  added. The form carries a token so sending it twice makes one order.
- **Customers** (`/admin/customers`, `src/db/queries/admin-customers.ts`): everyone who
  has ordered, plus anyone added by hand. Search, sort, tabs for new, returning and
  those who get marketing emails. A customer's page has their details, notes, orders
  and an "Add an order for them" button. Customers with orders can't be deleted.
  `accepts_email` means they agreed to marketing emails; order emails ignore it.
  Anyone in `email_optouts` unsubscribed themselves and is never sent marketing.
- **Campaigns** (`/admin/campaigns`, `src/lib/email/campaigns.ts`): marketing emails
  written in the admin (subject, preview line, message, optional photo and button).
  They go to customers marked "Agreed to get marketing emails" plus `subscribers`,
  minus anyone in `email_optouts`. Sent through Resend from `siteConfig.newsEmail`.
  Starting a campaign writes one `campaign_sends` row per person, each with its own
  unsubscribe token. A sender takes people from that queue under a name for the
  request they go in (`batch_key`); a person can only be taken once, goes back in the
  queue only when it is certain nothing was sent, and is otherwise sent again later
  under the same name, which Resend recognises as a repeat. So nobody gets a campaign
  twice, whether Send is pressed twice, two people press it, or an answer is lost
  (`npm run test:campaign`). The editor chooses a new campaign's id, so a repeated
  save or send is the same campaign.
  Every email has an unsubscribe link (`/unsubscribe/[token]`) and the one-click
  header mail apps use (`POST /api/unsubscribe/[token]`). Unsubscribing takes effect
  at once. **Campaigns can't be sent until `siteConfig.mailingAddress` is filled in**:
  the postal address is required at the foot of every marketing email.
- **Inbox** (`/admin/inbox`, `src/lib/mail/gmail.ts`): the store's Gmail
  (`siteConfig.inboxEmail`) read over IMAP and sent from over SMTP, signed in with an
  app password in `GMAIL_APP_PASSWORD`. Nothing is copied into the database; each page
  reads Gmail directly, so it is always what Gmail has. List (Inbox and Sent), search
  (Gmail's own search), open, reply, write new, download attachments, mark unread.
  **Email content is untrusted.** HTML bodies are only ever shown inside a sandboxed
  frame (no scripts, no forms, no access to the admin) with a rule that blocks every
  outside request; pictures load only when asked for. Attachments are always sent as
  downloads with a neutral type. Keep it that way: never put a message's HTML into the
  admin page itself.
- **Refunds:** the Refund box on an order sends the money back through Square, in full
  or in part, and counts it in `orders.refunded_cents`. A full refund closes the order.
  Each refund carries a key built from the order, what was already refunded, the
  amount and how many attempts have finished, so a second click or a retry after no
  answer can never refund twice. If Square reports later that a refund failed
  (`refund.updated` webhook), the amount is taken back off the order and the order is
  flagged. Cancelling an order still returns no money by itself.
- **Emails to customers** (`src/lib/email`): order placed (sent once, by whichever of
  the webhook or the confirmation page saves the order), shipped (a ticked box on the
  shipping form) and refunded. Each is written to the order's history, sent or failed.
  A failed email never undoes the order change. Sent through Resend from
  `siteConfig.ordersEmail`; needs `RESEND_API_KEY` and the domain verified in Resend.
  Without the key the store runs as before and the order page offers a ready-written
  tracking email that opens in the owner's mail app.
- **Admin changes show on the store straight away:** every product and category action
  clears the catalog cache (`CATALOG_TAG`). Prices at checkout are read from the
  database every time.

- **Discounts** (`/admin/discounts`, `src/db/queries/admin-discounts.ts`): codes that
  take a percentage off, an amount off, or make shipping free. Each can have a minimum
  order, a limit on total uses, "one use per customer", a start and an end (typed in
  the store's time zone, `siteConfig.timeZone`), an on/off switch and a private note.
  The list filters by status and type and sorts by newest, code, most used, biggest
  and ending soonest. A code's page shows how often it was used, what it took off and
  the orders that used it. Deleting a code leaves those orders with its name.
  What a code is worth is only ever worked out on the server
  (`src/lib/checkout/discounts.ts`). One code per order. A percentage or amount comes
  off the items, never the shipping, and never more than the items cost.
  `?code=SAVE20` on any store address saves that code for checkout
  (`src/components/cart/code-link.tsx`), which is how emails apply a code in one tap.
  "One use per customer" is checked against the email given at checkout. Someone who
  changes their email on the payment page gets through. Limits, end dates and the
  on/off switch are checked when the payment page is opened, and Square's payment
  pages don't expire, so someone who opened one while a code still worked can pay
  with it later. Either way the order is saved (they have paid) and **flagged for
  attention** with what happened, so it is seen before it ships.
  The use is counted in a savepoint of its own inside the order's transaction: a
  paid order is saved even if the code has been deleted in the meantime.
- **The marketing box at checkout** ("Email me new designs and offers") is recorded
  on the Square order and only acted on once the order is paid, which is what shows
  the address belongs to the person who typed it. It never lifts an unsubscribe.
  Unticking "Agreed to get marketing emails" on a customer in the admin counts as an
  unsubscribe too (`email_optouts`, source `admin`), so it stops cart reminders as
  well as campaigns.
- **The "delivered" email with a thank-you code** is partly an offer, so the code is
  left out for anyone who has unsubscribed or has already used it, and the email
  carries an unsubscribe link (the order's own id is the token).
- **Automatic emails** (`/admin/campaigns/automatic`, settings saved in
  `store_settings` under `emails.automation`, read through `src/lib/email/automation.ts`):
  cart reminders on or off, how long each of the three waits, a code for each, and a
  thank-you code for the "delivered" email. Every automatic email has a preview page
  with a "send a test to me" button (`src/lib/email/samples.ts`).
- **Cart reminders** (`src/lib/email/cart-reminders.ts`, `src/db/queries/carts.ts`):
  when a customer gives their email at checkout and goes to pay, the cart is saved in
  `abandoned_carts`. If no order follows, up to three reminders go out (defaults: 1,
  24 and 72 hours after they left; `left_at` is the clock). A cart is closed when its
  owner orders, unsubscribes, or a week passes. Starting checkout again moves the
  clock but never restarts the series, and an address gets at most one series of
  three a month however many carts are started with it, so the checkout form can't
  be used to pester someone. A cart is marked as reminded before the email is sent,
  so a failed send misses one reminder rather than risking two. A reminder only
  offers its code to someone who can use it: the cart meets the minimum and they
  haven't already had their one use. The button in the email
  (`/cart/[token]`) refills the cart on whatever device opens it and goes to checkout.
  Reminders are marketing email: they carry the mailing address and an unsubscribe
  link, go out from `siteConfig.newsEmail`, and don't send until the mailing address
  is filled in. `vercel.json` calls `/api/cron/cart-reminders` every 30 minutes. The
  address does nothing but send what is already due, so it is safe if called by
  anyone; set `CRON_SECRET` in Vercel to lock it to Vercel's own timer anyway.
- **Campaign templates and codes:** the campaign editor starts from ready-made
  templates (`src/lib/email/presets.ts`) and can show a discount code. The email then
  has the code in a box and its button carries `?code=`. A campaign with a part still
  in [BRACKETS], or with a code that can no longer be used, can't be sent.
- **What the emails look like** (`src/lib/email/templates.ts`): dark, like the store,
  with the logo (`public/email/logo.png`) and Anton for headlines where the mail app
  loads fonts (`public/email/anton.woff2`). Built with tables and inline styles. One
  column, the button near the top and at least 56px tall. The mailing address is the
  last line of every email, small and quiet on purpose; it must stay in every
  marketing email.

Not built yet: staff accounts, the "delayed order" email, the fulfilment connection
to the printer, a newsletter sign-up form on the store.

## When a page fails to load

`src/app/error.tsx` and `src/app/global-error.tsx` both show
`src/components/site/load-error.tsx`. The first failure on an address reloads the page
once, quietly; a second within 30 seconds shows a message with a "Try again" button.

This is there for one known case. Saving in the admin clears the store's cache with
`updateTag`. Until a page has been rebuilt, a visitor who follows a link to it before
the link has been prefetched (a menu or footer link tapped quickly) can be sent half an
answer by the framework, which React reports as "Connection closed". A full page load
always gets the whole page, so the reload fixes it. `revalidateTag(tag, "max")` avoids
the error but left the store showing the old content, so it isn't used.

## Forms that need the backend

These are designed but not on the site yet, because they have nowhere to send data:

- Email signup (writes to `subscribers`). Needs the consent wording and a working
  unsubscribe link before the first send.
- Contact form (email to support, with rate limiting).
- Review submission (writes to `reviews`, verified against a paid order).

## Policy terms live in one place

`src/lib/site-config.ts` holds the production time, shipping time, cancel window and
issue window. Order emails and checkout must read from it too, so the site never
promises one thing on a policy page and another in an email.

## How checkout works

Payments run on Square. All Square code is in `src/lib/payments/`.

- The checkout page (`/checkout`) shows the order, takes a discount code and asks for
  an email, then hands over to Square. It gets its numbers from
  `/api/checkout/quote`, which saves nothing.
- The browser sends only product, color, size and quantity, the code as typed and the
  email to `/api/checkout`. Prices, the discount and shipping are worked out on the
  server (`src/lib/checkout/pricing.ts`, `src/lib/checkout/discounts.ts`). A code that
  can't be used stops checkout with the reason, so nobody pays full price by surprise.
- The server creates a Square order and sends the customer to Square's hosted payment
  page for it, with the email filled in. The discount goes to Square as an order
  discount and the code's name rides along in the order's `metadata`, which is how
  the saved order knows which code was used. A free shipping code leaves the shipping
  fee off. No card data touches this site.
- An order is saved when Square confirms the payment. Two things trigger that, and
  whichever comes second changes nothing: Square's webhook (`/api/webhooks/square`)
  and the customer landing on the confirmation page.
- Neither trigger is trusted for amounts. Both only name a payment; what was paid is
  read back from Square with the access token.
- Each event is stored once and each payment can create one order.
- The only secret is `SQUARE_ACCESS_TOKEN`. The store detects sandbox or live, picks
  the location and registers its own webhook. The webhook's signature key is kept in
  `store_settings`.
- Shipping is charged at the printer's rate (`siteConfig.shipping.rates`).
- `/api/health` reports the payment setup without exposing anything secret. It also
  saves a tiny test image and loads it back from the public image address (`upload`),
  and says whether email can go out (`email`). Once `RESEND_API_KEY` is set it adds
  the store's domain to Resend by itself and lists the DNS records still needed
  (`emailDns`) until Resend has verified them.
