# Product pricing, options & stock

How a product's price, sale, and stock are determined, and how the admin editor
maps onto the stored data.

## Two pricing modes

A product is one of two shapes, decided by whether any **option dropdown affects
pricing**:

- **Mode 1 — simple product.** No dropdowns, or every dropdown is marked
  *attribute-only*. The top-level **Pricing & sale** fields (base price, sale %,
  stock) drive everything. Attribute-only dropdowns (e.g. Colour) are plain
  selectors that never change price/sale/stock.

- **Mode 2 — priced variants.** At least one dropdown is price-affecting. Each of
  its options carries its own price / sale % / stock, and the selected option
  drives the product's figures. The top-level Pricing & sale section is then a
  fallback only and is disabled in the editor. The **first option** of the
  price-affecting dropdown is the product's *default representation* (the price,
  sale, and stock shown before the shopper changes anything). When several
  dropdowns affect pricing, the later one wins.

## Option data shape (`products.option_groups`, JSONB)

```jsonc
[
  {
    "label": "Pack Size",
    "affectsPricing": true,        // false = attribute-only selector
    "options": [
      { "value": "24 pieces", "price": 89.99, "salePercent": 15, "stock": 120 },
      { "value": "48 pieces", "price": 159.99, "salePercent": null, "stock": null }
    ]
  }
]
```

- `price` — `null` inherits the base price.
- `salePercent` — `null` inherits the product-level sale %; a number (0–100, two
  decimals) overrides it (including `0` to force "no sale").
- `stock` — `null` inherits the product-level stock; a number sets per-option stock.

**Backward compatibility:** rows saved before this feature have options with only
`{ value, price }` and no `affectsPricing`. On read, a group is treated as
price-affecting if any option has a price, and the missing `salePercent`/`stock`
become `null` (inherit) — so existing products keep their original behaviour
until an admin edits per-option values.

## Derivation of the legacy top-level columns

`buildRow` (in `src/services/productService.ts`) always writes the top-level
columns (`price_regular`, `price_sale`, `is_on_sale`, `sale_percent`, `stock`,
`image_url`) from the **default representation** via `resolveDefaultPricing`:
Mode 1 uses the base fields; Mode 2 uses the first option of the price-affecting
group(s). This keeps the public product **listing** and the **cart** reads correct
without their having to understand option modes. `image_url` is the first image,
so reordering images changes the main image.

## Where the logic lives

| Concern | Location |
|---|---|
| Types | `src/models/types.ts` (`ProductOption`, `ProductOptionGroup.affectsPricing`) |
| Normalise + derive defaults + clamp sale % | `src/services/productService.ts` (`asOptionGroups`, `resolveDefaultPricing`, `clampSalePercent`) |
| Admin input sanitisation | `src/controllers/adminProductController.ts` |
| Cart price/sale/stock resolution + per-option stock clamp | `src/services/cartService.ts` (`resolvePricing`, `getItemStock`) |
| Admin editor (image reorder, toggle, per-option fields, mode UI) | `public/admin.js` + `public/admin.html` |
| Storefront selection (price/sale/stock per option, qty cap) | `public/product.html` |

## Admin editor notes

- **Images** are drag-to-reorder (grab the ⠿ handle); the first row is flagged
  **MAIN** and becomes `image_url`.
- **Sale %** (base and per-option) is capped to 0–100 with two decimals.
- Each price-affecting dropdown shows **Price / Sale % / Stock** per option; the
  **attribute-only** toggle hides those and reverts the product to the base
  Pricing & sale fields. Per-option Sale %/Stock left blank = *inherit*.
