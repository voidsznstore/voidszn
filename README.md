# VOIDSZN

Print-on-demand clothing store with its own backend. Nothing is in season.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS 4, brand tokens in `src/app/globals.css` |
| Database | PostgreSQL |
| ORM and migrations | Drizzle ORM, SQL migrations in `drizzle/` |
| Fonts | Anton, Archivo, JetBrains Mono, bundled with the app |
| Hosting | Vercel, deployed by git push |

## Getting started

```bash
npm install
cp .env.example .env.local   # then set DATABASE_URL
npm run db:migrate           # creates every table
npm run dev                  # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:generate` | Create a new migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:studio` | Browse the database in a local UI |
| `npm run db:smoke` | Constraint and race-condition checks. Scratch databases only. |

## Changing the database

1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate`. A new SQL file appears in `drizzle/`.
3. Read the SQL, commit it, and run `npm run db:migrate`.

Migrations are plain SQL files in git. Nothing is ever pushed to the database without one.

## Rules this codebase follows

- **Money is integer cents.** Format it only with `src/lib/money.ts`.
- **The server sets prices.** Checkout recalculates every total from the database. Cart contents sent by the browser are only variant ids and quantities.
- **Cost stays private.** `costCents` is never selected in a public query.
- **No stock tracking.** Everything is printed to order.
- **Payments are confirmed by signed webhook only**, never by the return URL. Each webhook event is stored once in `webhook_events` so replays are ignored.
- **Discount limits are enforced in the database.** See `src/db/queries/discounts.ts`.
- **Payment and fulfillment are provider-neutral.** Fields are named `paymentRef`, `externalOrderId` and so on, so either provider can be swapped.

## Project docs

- `docs/backend-notes.md`: requirements for the backend and admin, including sorting and filtering by category
- `docs/launch-checklist.md`: legal and compliance checklist to clear before taking real orders
- `src/lib/site-config.ts`: business details and policy terms used by every page

## Brand

- Logo: Eclipse wordmark, `src/components/brand/eclipse-logo.tsx`
- Colors: void `#0A0A0A`, ash `#1A1A1A`, smoke `#A3A3A3`, bone `#EDEAE3`, accent rust `#C4622D`
- To change the accent, edit `--color-accent` in `src/app/globals.css`.

## Build status

- [x] 1. Brand kit
- [x] 2. Homepage, product page and cart designs
- [x] 3. Project scaffold
- [x] 4. Database schema and first migration
- [ ] 5. Storefront and cart (homepage, category pages, product page and help and policy pages are up with sample products from `src/lib/catalog.ts`; cart and database-backed catalog still to do)
- [ ] 6. Checkout and payments
- [ ] 7. Admin panel
- [ ] 8. Fulfillment module
