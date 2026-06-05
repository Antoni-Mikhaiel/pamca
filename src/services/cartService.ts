import { supabase } from "../lib/supabase.js";
import { CartItem, ProductOption, ProductOptionGroup } from "../models/types.js";
import { getProductBySlug, asOptionGroups, clampSalePercent } from "./productService.js";
import { asVariants, resolveCombinationStock, variantKey } from "../lib/variants.js";

export interface SelectedOption {
  label: string;
  value: string;
}

export type AddToCartResult = { ok: true } | { ok: false; reason: "not_found" | "sold_out" | "invalid_quantity" };

/**
 * Resolves a product's effective regular price and sale % for a given option
 * selection. Both come from the single pricing dropdown (the first group flagged
 * `affectsPricing`); every other dropdown is attribute-only. `pick` chooses the
 * relevant option for a group, defaulting to its first option. (Stock is no longer
 * derived here — it's resolved per combination from `Product.variants`.)
 */
function resolvePricing(
  base: { regular: number; salePercent: number },
  groups: ProductOptionGroup[],
  pick: (group: ProductOptionGroup) => ProductOption | undefined,
): { regular: number; salePercent: number } {
  const groupsWithOptions = groups.filter((g) => g.options.length > 0);

  let { regular, salePercent } = base;
  const pricingGroup = groupsWithOptions.find((g) => g.affectsPricing);
  if (pricingGroup) {
    const opt = pick(pricingGroup) ?? pricingGroup.options[0];
    if (opt.price != null) regular = Number(opt.price);
    if (opt.salePercent != null) salePercent = clampSalePercent(opt.salePercent);
  }

  return { regular, salePercent };
}

export interface ResolvedLine {
  productId: number;
  productName: string;
  variationLabel: string | null;
  /** Effective unit price (sale applied), in dollars. */
  unitPrice: number;
  stock: number;
  imageUrl: string | null;
}

/**
 * Resolves a product + option selection to its authoritative unit price, display
 * name, variation label, available stock, and image — recomputed server-side so
 * the client can never dictate what it pays. Price resolution mirrors the product
 * page: a selected option's price (when set) overrides the base price (later priced
 * options win) and an active sale is then applied. Shared by add-to-cart and the
 * order-edit flow (pricing newly added items at the current catalog price).
 */
export async function resolveProductLine(
  slug: string,
  selectedOptions: SelectedOption[],
): Promise<{ ok: true; line: ResolvedLine } | { ok: false; reason: "not_found" | "sold_out" }> {
  const product = await getProductBySlug(slug);
  if (!product) return { ok: false, reason: "not_found" };

  const pick = (group: ProductOptionGroup) => {
    const selected = selectedOptions.find((o) => o.label === group.label);
    return selected ? group.options.find((o) => o.value === selected.value) : undefined;
  };

  const resolved = resolvePricing(
    {
      regular: Number(product.price_regular) || 0,
      salePercent: product.is_on_sale ? clampSalePercent(product.sale_percent) : 0,
    },
    product.option_groups,
    pick,
  );

  // Build the combination in dropdown order so the label/key match the stored
  // variants and what the cart records, then resolve that combination's stock.
  const groupsWithOptions = product.option_groups.filter((g) => g.options.length > 0);
  const selectedValues = groupsWithOptions.map((g) => (pick(g) ?? g.options[0]).value);
  const stock = resolveCombinationStock(
    product.variants,
    product.option_groups,
    selectedValues,
    Number(product.stock) || 0,
  );

  if (stock <= 0) return { ok: false, reason: "sold_out" };

  const unitPrice =
    resolved.salePercent > 0
      ? Number((resolved.regular * (1 - resolved.salePercent / 100)).toFixed(2))
      : Number(resolved.regular.toFixed(2));

  const variationLabel = variantKey(selectedValues) || null;

  return {
    ok: true,
    line: {
      productId: product.id,
      productName: product.name,
      variationLabel,
      unitPrice,
      stock,
      imageUrl: product.image_url,
    },
  };
}

/**
 * Adds a product (with its selected options) to the anonymous cart. Adding an
 * identical line (same product + variation label) merges into the existing row
 * instead of creating a duplicate. Pricing/stock come from {@link resolveProductLine}.
 */
export async function addToCart(params: {
  cartToken: string;
  slug: string;
  selectedOptions: SelectedOption[];
  quantity: number;
}): Promise<AddToCartResult> {
  const { cartToken, slug, selectedOptions, quantity } = params;
  if (!Number.isFinite(quantity) || quantity < 1) return { ok: false, reason: "invalid_quantity" };

  const resolved = await resolveProductLine(slug, selectedOptions);
  if (!resolved.ok) return resolved;
  const { line } = resolved;
  const maxQty = Math.max(1, line.stock);

  let lookup = supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_token", cartToken)
    .eq("product_id", line.productId);
  lookup =
    line.variationLabel === null
      ? lookup.is("variation_label", null)
      : lookup.eq("variation_label", line.variationLabel);

  const { data: existingRows, error: lookupError } = await lookup;
  if (lookupError) throw lookupError;

  const existing = (existingRows ?? [])[0] as { id: string; quantity: number } | undefined;

  if (existing) {
    const newQty = Math.min(existing.quantity + quantity, maxQty);
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: newQty, unit_price: line.unitPrice, image_url: line.imageUrl })
      .eq("id", existing.id)
      .eq("cart_token", cartToken);
    if (error) throw error;
    return { ok: true };
  }

  const { error } = await supabase.from("cart_items").insert({
    cart_token: cartToken,
    product_id: line.productId,
    variation_id: null,
    quantity: Math.min(quantity, maxQty),
    product_name: line.productName,
    variation_label: line.variationLabel,
    unit_price: line.unitPrice,
    image_url: line.imageUrl,
  });
  if (error) throw error;
  return { ok: true };
}

/** Removes every line in a cart — used after a successful checkout. */
export async function clearCart(cartToken: string): Promise<void> {
  const { error } = await supabase.from("cart_items").delete().eq("cart_token", cartToken);
  if (error) throw error;
}

export async function getCartItems(cartToken: string): Promise<CartItem[]> {
  const { data, error } = await supabase
    .from("cart_items")
    .select("id, cart_token, product_id, variation_id, quantity, product_name, variation_label, unit_price, image_url")
    .eq("cart_token", cartToken)
    .gt("quantity", 0)
    .order("id", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CartItem[];
}

export interface QuantityUpdateResult {
  /** Quantity actually stored after clamping (0 means the line was removed). */
  applied: number;
  /** The product's available stock, or null when it could not be determined. */
  stock: number | null;
  /** True when the requested quantity was above stock and had to be reduced. */
  clamped: boolean;
}

export async function updateCartQuantity(params: {
  cartToken: string;
  itemId: string;
  quantity: number;
}): Promise<QuantityUpdateResult> {
  if (params.quantity <= 0) {
    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", params.itemId)
      .eq("cart_token", params.cartToken);
    if (error) throw error;
    return { applied: 0, stock: null, clamped: false };
  }

  // Never let a line exceed the product's available stock, even if the client
  // requests more (e.g. stock was lowered after the item was added).
  const stock = await getItemStock(params.itemId, params.cartToken);
  const applied = stock != null && stock > 0 ? Math.min(params.quantity, stock) : params.quantity;

  const { error } = await supabase
    .from("cart_items")
    .update({ quantity: applied })
    .eq("id", params.itemId)
    .eq("cart_token", params.cartToken);
  if (error) throw error;

  return { applied, stock, clamped: stock != null && stock > 0 && params.quantity > applied };
}

/**
 * Looks up the available stock for a cart line (null if unknown). The stored
 * variation label identifies the option combination, whose stock is read from the
 * product's `variants`; products without dropdowns use the base stock.
 */
async function getItemStock(itemId: string, cartToken: string): Promise<number | null> {
  const { data: item, error: itemError } = await supabase
    .from("cart_items")
    .select("product_id, variation_label")
    .eq("id", itemId)
    .eq("cart_token", cartToken)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) return null;
  const row = item as { product_id: number; variation_label: string | null };

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("stock, option_groups, variants")
    .eq("id", row.product_id)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) return null;

  const prod = product as { stock: number; option_groups: unknown; variants: unknown };
  const baseStock = Math.max(0, Math.round(Number(prod.stock) || 0));
  const groups = asOptionGroups(prod.option_groups);
  if (groups.filter((g) => g.options.length > 0).length === 0) return baseStock;

  const selectedValues = (row.variation_label ?? "")
    .split(" / ")
    .map((s) => s.trim())
    .filter(Boolean);

  return resolveCombinationStock(asVariants(prod.variants), groups, selectedValues, baseStock);
}

export async function removeCartItem(cartToken: string, itemId: string): Promise<boolean> {
  const { error, count } = await supabase
    .from("cart_items")
    .delete({ count: "exact" })
    .eq("id", itemId)
    .eq("cart_token", cartToken);

  if (error) throw error;
  return (count ?? 0) > 0;
}
