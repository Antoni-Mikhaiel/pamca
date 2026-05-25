# Vercel Migration Plan (Completed Structure + Next Steps)

## New deployable structure

```text
.
├─ api/
│  ├─ ajax.ts
│  ├─ cart/
│  │  └─ get.ts
│  ├─ contact/
│  │  └─ submit.ts
│  └─ products/
│     ├─ [slug].ts
│     └─ index.ts
├─ public/
│  ├─ *.html (converted pages)
│  ├─ images/
│  ├─ style.css
│  ├─ shared-styles.css
│  ├─ shared-scripts.js
│  └─ partials/
│     ├─ header.html
│     └─ footer.html
├─ src/
│  ├─ controllers/
│  ├─ services/
│  ├─ models/
│  └─ lib/
├─ docs/
│  ├─ endpoint-mapping.md
│  ├─ php-to-serverless-example.md
│  └─ supabase-schema.sql
├─ vercel.json
├─ package.json
├─ tsconfig.json
└─ .env.example
```

## Step-by-step rollout

1. Create Supabase tables using `docs/supabase-schema.sql`.
2. Seed product and variation data used by product pages.
3. Configure Vercel environment variables from `.env.example`.
4. Deploy to Vercel and validate cart/contact flows.
5. Run UI parity checks page-by-page against current production.
6. Switch DNS after validation.

## Important note

The backend has been refactored away from WordPress/PHP. Frontend files were converted to static HTML and wired to API routes with compatibility behavior for cart AJAX responses.
