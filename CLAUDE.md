# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PAMCA is a pharmacy/e-commerce site that was migrated from WordPress/PHP to a TypeScript stack: static HTML frontend + Vercel serverless API functions + Supabase (Postgres) + Brevo (transactional email). The API deliberately preserves the legacy WordPress request/response shapes so the existing frontend keeps working — see `docs/endpoint-mapping.md` for the legacy→new mapping.

## Commands

```bash
npm install
npm run dev        # local server with hot reload (tsx watch), http://localhost:3000
npm start          # local server, no watch
npm run typecheck  # tsc --noEmit
npm test           # unit tests (tests/*.test.ts, Node test runner via tsx; offline, no DB)
npm run build      # typecheck + scripts/build-static.ts: public/ -> dist/ (header/footer inlined, ?v= asset hashes, JS/CSS minified); Vercel serves dist/
npm run preview    # build, then serve dist/ locally (what production serves)
```

There is no linter. `npm test` runs offline unit tests for the money/security-critical pure logic; `npm run build` runs typecheck + tests before producing `dist/`, so a failing test blocks the deploy. The app is run with `tsx` (TypeScript executed directly); TypeScript is never compiled. `dist/` is only the static site output of `npm run build` (git-ignored) — edit `public/`, never `dist/`.

Before the server will boot you need a `.env` (see existing `.env` for keys) and the schema in `docs/supabase-schema.sql` applied to the Supabase project.

## Architecture

### Dual runtime — the key thing to understand

The same request handlers run in **two** environments, so handlers must stay platform-agnostic:

1. **Vercel** — a single catch-all Serverless Function [api/[...path].ts](api/[...path].ts) receives every `/api/*` request (Vercel exposes the segments as `req.query.path`), rebuilds the pathname, and hands off to the shared router.
2. **Local dev** — `scripts/dev-server.ts` is a hand-rolled Node `http` server that serves `public/` statically and hands `/api/...` requests to the *same* shared router.

The shared router is [src/lib/routes.ts](src/lib/routes.ts): a single `routes` table (method + path regex → controller handler) and a `dispatch(req, res, pathname)` function that matches, injects any dynamic segment into `req.query`, and catches handler errors. **Collapsing every endpoint into one function keeps the deployment within the Hobby plan's 12-function limit** (there were 13 separate functions before).

Both runtimes rely on the `ApiRequest`/`ApiResponse` abstraction in [src/lib/http.ts](src/lib/http.ts) — a minimal subset of the Vercel signature (`status()`, `json()`, `send()`, `setHeader()`, `query`, `body`, `headers`, `cookies`). Never reach for Node `http` types or Vercel-specific request fields inside a handler/controller; only `dev-server.ts` knows about raw `http.IncomingMessage`.

**To add or rename an API route, edit one place:** the `routes` array in [src/lib/routes.ts](src/lib/routes.ts). Use `param` for a dynamic segment (e.g. `/^\/api\/products\/([^/]+)$/` with `param: "slug"`) — `dispatch` injects the captured value into `req.query` under that name. No new files, no per-endpoint functions. (Note: `dev-server.ts` imports [scripts/load-env.ts](scripts/load-env.ts) *first* so `.env` is loaded before the router pulls in `src/lib/supabase.ts`, which throws if `SUPABASE_*` are unset.)

### MVC layering (`src/`)

```
api/[...path].ts single catch-all function → src/lib/routes.ts dispatch
src/controllers  parse/validate input, shape the response (cart, contact, product)
src/services     all I/O: Supabase queries, Brevo email, reCAPTCHA verify
src/lib          http helpers, routes table/dispatch, Supabase client, mini-cart HTML
src/models       shared TypeScript types
```

Keep Supabase/Brevo calls in `src/services`; controllers should not touch the DB client directly.

### Notable conventions

- **`/api/ajax`** is a single endpoint that multiplexes legacy WordPress actions by the `action` field in the form body (`pamca_update_cart_qty`, `update_cart_item`, `pamca_remove_cart_item`). Bodies arrive as `application/x-www-form-urlencoded`; `parseBody()` in `src/lib/http.ts` normalizes form/JSON/object bodies into `Record<string, string>`.
- **Cart identity is anonymous**, keyed by a `cart_token` UUID stored in an HttpOnly cookie (`ensureCartToken` in `src/lib/http.ts`), not by a logged-in user. Cart rows live in the `cart_items` table.
- **Server-rendered cart markup**: the mini-cart HTML is generated on the server in [src/lib/miniCartHtml.ts](src/lib/miniCartHtml.ts) and returned in `data.html`; the client injects it verbatim. If you change cart DOM structure, change it here (and keep `escapeHtml` usage for any user/DB-derived strings).
- **Contact form** posts to `/api/contact/submit`, which validates a honeypot (`website_hp`), optional reCAPTCHA, sends via Brevo (`BREVO_API_KEY`), then **302-redirects** back to `/contact-us.html?status=...` (it does not return JSON).

### Frontend (`public/`)

Plain static HTML pages, no framework/bundler. [public/shared-scripts.js](public/shared-scripts.js) is the single client bootstrap: it injects `partials/header.html` + `partials/footer.html`, wires the cart modal, and hydrates product/cart data from the API.

**Header/footer are inlined server-side** (crawlable nav): pages keep empty `#header-placeholder`/`#footer-placeholder` divs in `public/`, and [src/lib/partials.ts](src/lib/partials.ts) fills them in the build, the dev server and the server-rendered pages; the client only fetches a partial if its placeholder is still empty. Asset URLs in pages get `?v=<content hash>` ([src/lib/assets.ts](src/lib/assets.ts)) and are cached for a year (`immutable` in `vercel.json`) — reference assets with plain absolute paths (`/x.js`, `/images/y.webp`) and the build/SSR stamp them. `/pharmacy-products` is server-rendered too (product cards + ItemList). Product photos go through Vercel Image Optimization (`/_vercel/image`, `vercel.json` `images`) via `optimizedImage()` — keep the server ([src/lib/images.ts](src/lib/images.ts)) and client (`public/shared-scripts.js`) versions identical.

**URLs & SEO.** Every page has one canonical clean URL (`/about-us`, `/pharmacy-products`, …); `vercel.json` rewrites it to the `.html` file and 308-redirects the `.html`/legacy URLs to it. Link to the clean URL, never the `.html`. Each indexable page carries a `<!-- seo:start -->…<!-- seo:end -->` head block (title, description, canonical, OG/Twitter); admin/profile/order are `noindex`. Product pages live at `/products/:slug` and are **server-rendered** by [src/controllers/pageController.ts](src/controllers/pageController.ts) (head + JSON-LD + inlined product data injected into the `public/product.html` template, which is bundled into the function via `functions.includeFiles`); `/sitemap.xml` is generated there too. The dev server reads `vercel.json` redirects/rewrites, so local routing matches production.

`public/auth.js` is the browser Supabase Auth client (anon key; session kept in `localStorage`). The admin console (`public/admin.js`) saves products, content, tax and orders through the `/api/admin/*` endpoints (Supabase), guarded by `requireAdmin`.

## Supabase keys

Server code (`src/lib/supabase.ts`) uses `SUPABASE_SERVICE_ROLE_KEY` (full access, server-only). Browser code uses `SUPABASE_ANON_KEY`. Never use the service-role key in anything under `public/`. Note: `.env` is git-ignored now, but it was committed in early history, so the keys it held must be treated as exposed until rotated. Never copy live keys into new files.

## Errors, cron jobs

- Throw `UserError` ([src/lib/errors.ts](src/lib/errors.ts)) for messages meant for the customer; any other error is logged and replaced by a generic message (`publicErrorMessage`) so DB/provider internals never reach the browser. Admin-only endpoints may return detail.
- Vercel crons (`vercel.json`): `/api/cron/keepalive` (monthly Brevo ping) and `/api/cron/cleanup` (daily: abandoned checkouts > 7 days incl. their Square payment links, carts > 45 days, old rate-limit rows). Both are guarded by `CRON_SECRET` via `requireCron`.
