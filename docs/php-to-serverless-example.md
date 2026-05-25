# Example Conversion: `pamca_update_cart_qty`

## Original PHP behavior

- Read `$_POST['cart_item_key']` and `$_POST['quantity']`
- Update cart quantity
- Return JSON:
  - `success: true`
  - `data.html`
  - `data.count`
  - `data.total_html`

## New serverless implementation

- Route: `api/ajax.ts`
- Controller: `src/controllers/cartController.ts` (`handleUpdateCartQty`)
- Service: `src/services/cartService.ts`
- HTML builder: `src/lib/miniCartHtml.ts`

### Request (same structure)

```http
POST /api/ajax
Content-Type: application/x-www-form-urlencoded

action=pamca_update_cart_qty&cart_item_key=<id>&quantity=2&security=stateless
```

### Response (same structure)

```json
{
  "success": true,
  "data": {
    "html": "<div class=\"cart-items\" id=\"cart-items\">...</div>",
    "count": 2,
    "total_html": "$79.98"
  }
}
```
