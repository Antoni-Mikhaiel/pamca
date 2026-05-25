# Square Hosted Checkout

PAMCA uses **Square Payment Links** (the Checkout API) for online payment. There
is no on-site checkout/payment page — the server builds a payment link from the
cart and redirects the shopper to Square's hosted page. After payment, Square
returns the shopper to the site and a webhook marks the order paid.

## Flow

```
shopper                     site (this app)                         Square
  | add to cart  ───────────►  POST /api/ajax (pamca_add_to_cart)
  |                            └─ cart_items row (price computed server-side)
  | Proceed to Checkout ─────► POST /api/checkout/create
  |                            ├─ snapshot cart → orders + order_items (pending)
  |                            └─ createPaymentLink() ──────────────► payment link
  |  ◄──────────────────────────────  redirect to Square hosted page ◄┘
  | pays on Square's page ───────────────────────────────────────────►
  |  ◄── redirect to {SITE_URL}/?order=success ──────────────────────┘
  |                            POST /api/checkout/webhook  ◄── payment.updated
  |                            ├─ verify signature
  |                            ├─ order → 'paid'
  |                            └─ clear cart
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ajax` (`action=pamca_add_to_cart`) | Add a product + selected options to the cart |
| POST | `/api/checkout/create` | Create a Square payment link for the current cart; returns `{ data: { url } }` |
| POST | `/api/checkout/webhook` | Receive Square payment events; marks the order paid and clears the cart |

Add-to-cart body (form-urlencoded): `slug`, `quantity`, `options` (JSON array of
`{ label, value }`). The server resolves the price from the product's
`option_groups` and active sale — the client price is never trusted.

## Environment variables

Set these in `.env` (local dev) and in the Vercel project settings (production):

| Var | Notes |
|---|---|
| `SQUARE_ENVIRONMENT` | `sandbox` or `production` (selects the API host) |
| `SQUARE_ACCESS_TOKEN` | Access token for the Square application (Developer Dashboard → your app → Credentials). Server-only secret. |
| `SQUARE_LOCATION_ID` | The location to attribute orders to (Dashboard → Locations, or `/v2/locations`) |
| `SQUARE_CURRENCY` | ISO 4217, default `CAD` |
| `SQUARE_API_VERSION` | Pinned `Square-Version` header, e.g. `2025-04-16` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Signature key from the webhook subscription; used to verify events. While blank, signature checks are skipped (setup only). |
| `SQUARE_WEBHOOK_URL` | The exact notification URL registered in Square. Defaults to `{SITE_URL}/api/checkout/webhook`. |
| `SITE_URL` | Used for the post-payment redirect (`{SITE_URL}/?order=success`) |

If `SQUARE_ACCESS_TOKEN` or `SQUARE_LOCATION_ID` is missing, `/api/checkout/create`
returns HTTP 503 with a friendly message and the cart UI shows "Online payment is
not available yet" — nothing breaks while you finish wiring Square.

## Linking Square (one-time setup)

1. Create an application at the [Square Developer Dashboard](https://developer.squareup.com/apps).
2. Copy the **Access token** and a **Location ID** (start with the *Sandbox* set to test).
3. Fill in the `SQUARE_*` vars above. Set `SQUARE_ENVIRONMENT=sandbox` first.
4. Add a **webhook subscription** pointing at `https://<your-domain>/api/checkout/webhook`,
   subscribe to `payment.created` and `payment.updated`, and copy the **signature key**
   into `SQUARE_WEBHOOK_SIGNATURE_KEY`. Set `SQUARE_WEBHOOK_URL` to the same URL.
5. Test a full purchase with a Square sandbox test card. Confirm the `orders` row
   flips to `paid` and the cart clears.
6. Switch `SQUARE_ENVIRONMENT=production` and swap in production credentials when ready.

> **Webhook raw body:** signature verification runs over the *raw* request body.
> The local dev server passes the raw string, so it works out of the box. On
> Vercel, ensure the function receives the unparsed body (do not re-serialize
> before verifying) — the handler reads `req.body` as a string when available.

## Database

`docs/supabase-schema.sql` defines `orders` and `order_items`. Apply the schema to
Supabase before going live. Money is stored in integer cents; `orders.status` moves
`pending → paid` (or `failed`/`canceled`). Each order keeps a snapshot of its items
so it stays accurate even if a product is later edited or removed.
