export interface ProductOption {
  value: string;
  /** Overrides the base price when this option is selected; null = inherit base price. */
  price: number | null;
  /** Per-option sale discount (0–100, two decimals); null = inherit the product-level sale. */
  salePercent: number | null;
  /** Per-option stock; null = inherit the product-level stock. Only used when the group affects pricing. */
  stock: number | null;
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
  description: string;
  keyFeatures: string[];
  optionGroups: ProductOptionGroup[];
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
  email: string;
  /** '+1' followed by exactly 10 digits (Canada only). */
  phone: string;
  address: string;
}

export interface UserProfile extends CustomerDetails {
  id: string;
  /** Supabase auth login email (read-only here; `email` above is the contact email). */
  loginEmail: string;
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
  total_cents: number;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  created_at: string;
  /** Admin early-lock; blocks edits (never refunds). */
  uneditable: boolean;
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
  inquiryType: string;
  message: string;
  recaptchaResponse: string;
  websiteHp: string;
}
