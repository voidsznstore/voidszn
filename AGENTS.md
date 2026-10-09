<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Read `docs/backend-notes.md` before working on the backend or admin. It holds requirements
  the owner has asked for, including sorting and filtering by category.
- Read `docs/launch-checklist.md` before adding checkout, email, texts, reviews, tracking
  pixels or anything else with legal requirements.
- Business details and policy terms live in `src/lib/site-config.ts`. Never hard-code a
  shipping time, return window or contact detail anywhere else.
- The catalog lives in the database and is managed in the admin (`/admin`). Storefront
  code reads it through `src/lib/catalog` (cached, cleared by `CATALOG_TAG`). Checkout
  reads prices straight from the database. `src/lib/catalog/sample.ts` is only a fallback
  for running without a database.
- Every admin page and every admin server action must call `requireAdmin()` first.
  Anything that changes payouts, profit shares or who is on the team calls
  `requireMaster()` instead.
- The master account is voidsznstore@gmail.com (Henry Palacios). "My dashboard" means
  that account. Israel and Adam have the same dashboard without the master controls.
- Money figures are never stored as totals. Read `docs/backend-notes.md` (Accounting,
  Payouts) and `docs/tax-notes.md` before touching `src/lib/accounting`. Never store a
  card or bank account number.
- Checkout takes the delivery address itself and works out sales tax from it
  (`src/lib/checkout/tax.ts`, the same rules as the books). Square is never asked for
  an address or sent ours. Read "How checkout works" in `docs/backend-notes.md` and
  `docs/tax-notes.md` before changing what a customer is charged.
- Any public endpoint that writes, sends email or calls a paid service takes a limit
  from `src/lib/rate-limit.ts` first.
- Admin pages keep their state when you navigate away (the framework hides them instead
  of unmounting). Key forms on their data or on `useRouter().bfcacheId` so a fresh visit
  starts clean.
