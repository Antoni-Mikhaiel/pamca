# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PAMCA is a pharmacy/e-commerce site that was migrated from WordPress/PHP to a TypeScript stack: static HTML frontend + Vercel serverless API functions + Supabase (Postgres) + Resend (email). The API deliberately preserves the legacy WordPress request/response shapes so the existing frontend keeps working — see `docs/endpoint-mapping.md` for the legacy→new mapping.

## Commands

```bash
npm install
npm run dev        # local server with hot reload (tsx watch), http://localhost:3000
npm start          # local server, no watch
npm run typecheck  # tsc --noEmit — the only "build"/CI check
npm run build      # alias for typecheck; emits nothing (tsx runs .ts directly)
```

There is **no test runner and no linter** configured. `npm run typecheck` is the only automated verification. The app is run with `tsx` (TypeScript executed directly); nothing is ever compiled to `dist/`.

Before the server will boot you need a `.env` (see existing `.env` for keys) and the schema in `docs/supabase-schema.sql` applied to the Supabase project.

## Architecture

### Dual runtime — the key thing to understand

The same request handlers run in **two** environments, so handlers must stay platform-agnostic:

1. **Vercel** — each file in `api/**/*.ts` exports a `default` async `handler(req, res)`.
2. **Local dev** — `scripts/dev-server.ts` is a hand-rolled Node `http` server that re-implements Vercel's routing. It serves `public/` statically and maps `/api/...` paths to the same `api/*` modules.

Both rely on the `ApiRequest`/`ApiResponse` abstraction in [src/lib/http.ts](src/lib/http.ts) — a minimal subset of the Vercel signature (`status()`, `json()`, `send()`, `setHeader()`, `query`, `body`, `headers`, `cookies`). Never reach for Node `http` types or Vercel-specific request fields inside a handler/controller; only `dev-server.ts` knows about raw `http.IncomingMessage`.

**When adding or renaming an API route you must update two places:** create the `api/**/*.ts` file *and* add an entry to the `routes` array in `scripts/dev-server.ts`. Note that array references modules with `.js` extensions (e.g. `"../api/ajax.js"`) even though the files are `.ts` — tsx resolves these. Dynamic segments (e.g. `api/products/[slug].ts`) are matched by regex in `dev-server.ts`, which injects the captured value into `req.query` (the `slug` capture is wired manually).

### MVC layering (`src/`)

```
api/**           thin entry points: try/catch wrapper → delegate to a controller
src/controllers  parse/validate input, shape the response (cart, contact, product)
src/services     all I/O: Supabase queries, Resend email, reCAPTCHA verify
src/lib          http helpers, the Supabase client, mini-cart HTML renderer
src/models       shared TypeScript types
```

Keep Supabase/Resend calls in `src/services`; controllers should not touch the DB client directly.

### Notable conventions

- **`/api/ajax`** is a single endpoint that multiplexes legacy WordPress actions by the `action` field in the form body (`pamca_update_cart_qty`, `update_cart_item`, `pamca_remove_cart_item`). Bodies arrive as `application/x-www-form-urlencoded`; `parseBody()` in `src/lib/http.ts` normalizes form/JSON/object bodies into `Record<string, string>`.
- **Cart identity is anonymous**, keyed by a `cart_token` UUID stored in an HttpOnly cookie (`ensureCartToken` in `src/lib/http.ts`), not by a logged-in user. Cart rows live in the `cart_items` table.
- **Server-rendered cart markup**: the mini-cart HTML is generated on the server in [src/lib/miniCartHtml.ts](src/lib/miniCartHtml.ts) and returned in `data.html`; the client injects it verbatim. If you change cart DOM structure, change it here (and keep `escapeHtml` usage for any user/DB-derived strings).
- **Contact form** posts to `/api/contact/submit`, which validates a honeypot (`website_hp`), optional reCAPTCHA, sends via Resend, then **302-redirects** back to `/contact-us.html?status=...` (it does not return JSON).

### Frontend (`public/`)

Plain static HTML pages, no framework/bundler. [public/shared-scripts.js](public/shared-scripts.js) is the single client bootstrap: it injects `partials/header.html` + `partials/footer.html`, wires the cart modal, and hydrates product/cart data from the API. Product **detail** pages are hydrated only for the slugs hardcoded in its `hydrateProductDetails` map. (`shared-scripts.js` is duplicated at the repo root; `public/shared-scripts.js` is the one actually served.)

`public/auth.js` is a separate browser Supabase auth client using the **anon** key and `sessionStorage`; it backs `admin.html`. The admin editor (`public/admin.js`) currently persists content to `localStorage` only.

## Supabase keys

Server code (`src/lib/supabase.ts`) uses `SUPABASE_SERVICE_ROLE_KEY` (full access, server-only). Browser code uses `SUPABASE_ANON_KEY`. Never use the service-role key in anything under `public/`. Note: `.env` (containing the service-role key) is currently committed and only `.vercel` is git-ignored — treat the live keys as sensitive and rotate them rather than copying them into new files.
