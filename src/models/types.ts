export interface ProductOption {
  value: string;
  /** Overrides the base price when this option is selected; null = inherit base price. */
  price: number | null;
  /** Per-option sale discount (0–100, two decimals); null = inherit the product-level sale. */
  salePercent: number | null;
  /**
   * @deprecated Legacy per-option stock. Stock is now tracked per *combination* in
   * `Product.variants`; kept only so pre-migration rows still resolve a stock value.
   */
  stock: number | null;
}

/** Stock for one option combination, keyed by the option values joined " / " in dropdown order. */
export interface ProductVariantStock {
  key: string;
  stock: number;
}

export interface ProductOptionGroup {
  label: string;
  /**
   * When true, this dropdown's selected option drives the product's price, sale,
   * and stock (the top-level Pricing & Sale fields become a fallback/default).
   * When false, the dropdown is an attribute-only selector (e.g. colour) that
   * does not change price or stock.
   */
  affectsPricing: boolean;
  options: ProductOption[];
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  description: string;
  image_url: string | null;
  price_regular: number;
  price_sale: number | null;
  is_on_sale: boolean;
  /** Unit cost (COGS) for the admin Dashboard's profit metric; 0 when unset. */
  cost_price: number;
  /** Shipping weight per unit in grams; 0 = unset → checkout uses the default fallback. */
  weight_grams: number;
  /** How this product ships: 'canada_post' (weight-based rate) or 'third_party' (flat price). */
  shipment_method: string;
  /** Flat shipping price (dollars) charged once for this product when shipment_method is 'third_party'. */
  third_party_shipping_price: number;
  redirect_path: string;
  // Rich fields managed by the admin console (see supabase-schema.sql).
  status: string;
  images: string[];
  sale_percent: number;
  sale_start: string | null;
  sale_end: string | null;
  stock: number;
  /** Bullet list shown on the product page under "Specifications". */
  key_features: string[];
  option_groups: ProductOptionGroup[];
  /** Per-combination inventory (empty when the product has no dropdowns → use `stock`). */
  variants: ProductVariantStock[];
}

/** Shape the admin client sends/receives for a product. */
export interface AdminProductInput {
  id?: number | null;
  name: string;
  slug: string;
  status: string;
  images: string[];
  price: number;
  salePercent: number;
  saleStart: string;
  saleEnd: string;
  stock: number;
  /** Unit cost (COGS) for profit reporting; 0 when unset. */
  cost: number;
  /** Shipping weight per unit in grams; 0 when unset. */
  weight: number;
  /** 'canada_post' or 'third_party'. */
  shipmentMethod: string;
  /** Flat shipping price (dollars) for 'third_party' items; 0 otherwise. */
  thirdPartyShippingPrice: number;
  description: string;
  keyFeatures: string[];
  optionGroups: ProductOptionGroup[];
  /** Per-combination inventory (see Product.variants). */
  variants: ProductVariantStock[];
}

export interface ProductVariation {
  id: number;
  product_id: number;
  label: string;
  value: string;
  price_regular: number;
  price_sale: number | null;
  is_default: boolean;
}

export interface CartItem {
  id: string;
  cart_token: string;
  product_id: number;
  variation_id: number | null;
  quantity: number;
  product_name: string;
  variation_label: string | null;
  unit_price: number;
  image_url: string | null;
}

/** Delivery/contact details captured at checkout and editable on the profile page. */
export interface CustomerDetails {
  firstName: string;
  lastName: string;
  /** Optional business / pharmacy name (customers are pharmacies). Empty string when not given. */
  pharmacyName: string;
  email: string;
  /** '+1' followed by exactly 10 digits (Canada only). */
  phone: string;
  /** Street number (e.g. '1920'). */
  streetNumber: string;
  /** Street name (e.g. 'Yonge Street'). */
  streetName: string;
  /** City / municipality (e.g. 'Toronto'). */
  city: string;
  /** Canadian province code (e.g. 'ON', 'BC', 'AB'). */
  province: string;
  /** Canadian postal code (e.g. 'M4S 3E6'). */
  postalCode: string;
}

export interface UserProfile extends CustomerDetails {
  id: string;
  /** Supabase auth login email (read-only here; `email` above is the contact email). */
  loginEmail: string;
}

/**
 * One line in an order's shipping breakdown. Canada Post items are collapsed into a
 * single 'canada_post' line (Canada Post bills per parcel by combined weight); each
 * third-party-courier product contributes its own flat 'third_party' line.
 */
export interface ShippingLine {
  method: "canada_post" | "third_party";
  /** Display label: the Canada Post service name, or the product name for third-party. */
  label: string;
  cents: number;
}

export interface OrderItemRecord {
  /** order_items row id — present on persisted items, used to target edits. */
  id?: string;
  product_id?: number | null;
  product_name: string;
  variation_label: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export interface OrderRecord {
  id: string;
  purchase_id: string | null;
  status: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  hst_percent: number;
  /** Pre-tax Canada Post shipping charged to the customer (cents); 0 when none. */
  shipping_cents: number;
  /** Canada Post service code (e.g. "DOM.EP"); null for pickup / third-party-only. */
  shipping_service_code: string | null;
  /** Human-readable Canada Post service name (e.g. "Expedited Parcel"); null when none. */
  shipping_service_name: string | null;
  /** Per-line shipping breakdown (one combined Canada Post line + a line per third-party item). */
  shipping_breakdown: ShippingLine[];
  /** Canada Post tracking number entered by admin; null until the order ships. */
  tracking_pin: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_pharmacy_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_street_number: string | null;
  customer_street_name: string | null;
  customer_city: string | null;
  customer_province: string | null;
  customer_postal_code: string | null;
  created_at: string;
  /** Admin early-lock; blocks edits (never refunds). */
  uneditable: boolean;
  /** Admin fulfillment marker (ISO timestamp) surfaced to the customer; null = not completed. */
  completed_at: string | null;
  amount_refunded_cents: number;
  /** Computed: customer may still edit (paid, <24h, not locked, not refunded). */
  editable: boolean;
  /** Computed: customer may still refund (paid, <48h, not refunded). */
  refundable: boolean;
  items: OrderItemRecord[];
}

export interface ContactSubmission {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  recaptchaResponse: string;
  websiteHp: string;
}
