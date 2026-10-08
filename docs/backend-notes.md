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
