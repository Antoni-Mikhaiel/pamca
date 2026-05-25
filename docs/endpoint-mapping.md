# Endpoint Mapping

## Legacy WordPress AJAX to Vercel API

| Legacy endpoint | Payload action | New endpoint | Compatibility |
|---|---|---|---|
| `/wp-admin/admin-ajax.php` | `pamca_update_cart_qty` | `/api/ajax` | Same request and response shape (`success`, `data.html`, `data.count`, `data.total_html`) |
| `/wp-admin/admin-ajax.php` | `update_cart_item` | `/api/ajax` | Same request and response shape (`success`, `data.fragments`) |
| `/wp-admin/admin-ajax.php` | `pamca_remove_cart_item` | `/api/ajax` | Same request and response shape (`success`, `data.html`, `data.count`, `data.total_html`) |
| Contact form post to same PHP page | `contact_form_submitted=1` | `/api/contact/submit` | Redirect behavior preserved with query-status feedback |

## Product Data API

| Purpose | New endpoint |
|---|---|
| List all products | `/api/products` |
| Product by slug | `/api/products/:slug` |
| Read cart snapshot | `/api/cart/get` |

## Cart & Checkout

| Purpose | New endpoint |
|---|---|
| Add product to cart | `/api/ajax` (`action=pamca_add_to_cart`) |
| Create Square payment link | `/api/checkout/create` |
| Square payment webhook | `/api/checkout/webhook` |

See [square-checkout.md](square-checkout.md) for the full checkout flow and Square setup.
