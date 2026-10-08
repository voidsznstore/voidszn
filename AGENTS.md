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
- `src/lib/catalog.ts` is sample data standing in for the database.
