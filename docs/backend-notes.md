# Backend notes

Things to build or remember when the backend and admin panel are started. Add to this
file whenever a decision is made that the backend has to honor.

## Categories: sort and filter by category (requested by the owner)

The admin must be able to sort and filter by category everywhere products appear.

- **Admin product list:** filter by category (product type and interest), and sort by
  category name. Show each product's categories as a column.
- **Admin order and sales views:** filter and group sales by category, so it is clear
  which categories sell.
- **Category management:** create, rename, reorder and hide categories of both kinds.
  Drag to reorder categories (`categories.sort_order`) and to reorder products inside a
  category (`product_categories.sort_order`).
- **Product form:** pick exactly one product type and any number of interests.
- **Storefront:** category pages already exist at `/collections/[slug]` and sort by
  featured, newest and price. Swap `src/lib/catalog.ts` for database queries; keep the
  same function names so pages do not change.

The schema is ready for this: `categories.kind` (PRODUCT_TYPE or INTEREST) and the
`product_categories` join table, with an index on `(category_id, sort_order)`.

"Best Sellers" and "Just In" are not categories. They are automatic lists: best sellers
ranked from paid order items over a recent window, just in ordered by `products.created_at`.

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

- The browser sends only product, color, size and quantity to `/api/checkout`. Prices,
  shipping and tax codes are worked out on the server (`src/lib/checkout/pricing.ts`).
- Payment happens in Stripe's embedded checkout form. No card data touches this site.
- An order is written in one place only: the webhook at `/api/webhooks/stripe`, when
  Stripe confirms payment. The confirmation page never creates an order.
- Each webhook event is stored once and each payment can create one order, so retries
  and replays are harmless.
- The paid cart rides on the checkout session as metadata, so the order can be written
  from the webhook alone.
- Shipping is charged at the printer's rate (`siteConfig.shipping.rates`).

Still to do in admin: order list and detail (sortable by category), refunds (call
Stripe, then mark the order), the "delayed" email action, and order emails.
