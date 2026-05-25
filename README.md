# PAMCA Local Server

This project has been refactored from WordPress/PHP to a local Node.js server with matching API routes:

- Static frontend pages in `public/`
- Node.js API handlers in `api/`
- MVC backend structure in `src/`
- Supabase for product/cart persistence

## Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env` from `.env.example` and fill all values.

3. Apply database schema from `docs/supabase-schema.sql`.

4. Run locally

```bash
npm run dev
```

The app will start on `http://localhost:3000`.

## Notes

The local server serves `public/` and handles the existing `/api/...` routes directly, so you can debug everything before choosing any deployment target.
