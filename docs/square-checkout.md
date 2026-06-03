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
  | Proceed to Checkout ─────►  delivery-details pop-up (First/Last/Email/
  |                            Address/Phone; +1 Canada only). Pre-filled from
  |                            the profile when signed in; optional "save".
  | submit details  ────────► POST /api/checkout/create  {customer, saveProfile?}
  |                            ├─ snapshot cart → orders + order_items (pending)
  |                            ├─ stamp delivery details + 6-digit purchase_id
  |                            ├─ link order to user (if signed in) / save profile
  |                            └─ createPaymentLink(buyer prefill) ──► payment link
  |  ◄──────────────────────────────  redirect to Square hosted page ◄┘
  | pays on Square's page ───────────────────────────────────────────►
  |  ◄── redirect to {SITE_URL}/?order=success&pid=NNNNNN ───────────┘
  |                            POST /api/checkout/webhook  ◄── payment.updated
  |                            ├─ verify signature
  |                            ├─ order → 'paid'
  |                            ├─ decrement product stock (once, idempotent)
  |                            └─ clear cart
```

The shopper need not be signed in. A signed-in shopper has the pop-up pre-filled
from their profile and may tick "save these details" to update their defaults; the
order is also linked to their account so it shows on the profile page.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ajax` (`action=pamca_add_to_cart`) | Add a product + selected options to the cart |
| POST | `/api/checkout/create` | Create a Square payment link for the current cart. Body: `{ firstName, lastName, email, address, phone, saveProfile? }`; optional `Authorization: Bearer` links the order to the user. Returns `{ data: { url, purchaseId } }` |
| POST | `/api/checkout/webhook` | Receive Square payment events; marks the order paid, decrements stock once, clears the cart |
| GET | `/api/profile` | Signed-in shopper's saved details + order history (`Authorization: Bearer` required) |
| PUT | `/api/profile` | Update the contact/delivery fields (never the login email) |
| POST | `/api/orders/lookup` | Guest order lookup. Body: `{ purchaseId, phone }` — both must match |
| POST | `/api/orders/edit/preview` | Net price change + diff for a proposed edit. Auth: owner (`Bearer` + `orderId`) or guest (`purchaseId`+`phone`) |
| POST | `/api/orders/edit/commit` | Applies the edit. Returns `{ url }` (top-up to pay) or `{ applied, refundedCents }` |
| POST | `/api/orders/refund` | Full refund within 48h. Same owner/guest auth |
| GET | `/api/admin/orders` | All orders + items (admin) |
| POST | `/api/admin/orders/flag` | Set/clear an order's `uneditable` lock (admin; only within 24h) |

### Editing & refunds

- **Edit window:** 24h from `created_at`; also blocked once an admin sets `uneditable`
  (admin can only set that within the same 24h). **Refund window:** 48h, independent
  of `uneditable`. Both windows are enforced server-side and reflected in the
  `editable`/`refundable` flags on each order.
- An edit reduces/removes existing lines (refunded at the originally-paid price) and/or
  adds new lines (charged at the **current** catalog price). The **net** is what the
  shopper pays or is refunded:
  - **owes more →** the change is staged in `order_edits`, a Square payment link for the
    difference is returned, and the new items + stock are applied only when that top-up
    payment completes (webhook). Its redirect is `{SITE_URL}/?order=edit-success&pid=…`.
  - **owed money →** the difference is refunded to the card via the Square Refunds API and
    the change applies immediately.
- `orders.payments` is the charge ledger (`[{square_payment_id, amount_cents, refunded_cents}]`);
  refunds walk it and never exceed what was charged. `stock_applied` / the `order_edits`
  `pending→applied` claim keep stock and edits idempotent against webhook retries.
- Who can act: the signed-in owner, or a guest who passes the matching Purchase ID + phone.

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

The schema additions for this feature are all `add column if not exists` / `create
index if not exists`, so re-running `docs/supabase-schema.sql` on an existing project
is safe. New columns: `orders.purchase_id` (unique 6-digit ref), `orders.user_id`,
`orders.customer_*` (delivery details), `orders.stock_applied` (idempotent stock
guard); and `user_profiles.first_name/last_name/contact_email/address/phone`.
Stock is decremented when the webhook confirms payment — per-option stock when the
product uses option-level stock, otherwise the base `products.stock`.
