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
- **Orders:** worked by hand for now: mark as sent to the printer, then shipped with
  tracking, then delivered. Every change is written to the order's history with who
  did it.
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

Not built yet: staff accounts, discount codes, the "delayed order" email, the
fulfilment connection to the printer.

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

- The browser sends only product, color, size and quantity to `/api/checkout`. Prices
  and shipping are worked out on the server (`src/lib/checkout/pricing.ts`).
- The server creates a Square order and sends the customer to Square's hosted payment
  page for it. No card data touches this site.
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
