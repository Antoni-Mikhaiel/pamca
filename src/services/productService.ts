import { supabase } from "../lib/supabase.js";
import { AdminProductInput, Product, ProductOptionGroup, ProductVariation } from "../models/types.js";
import { asVariants, buildCombinationKeys, totalVariantStock } from "../lib/variants.js";

const PRODUCT_COLUMNS =
  "id, slug, name, description, image_url, price_regular, price_sale, is_on_sale, cost_price, weight_grams, redirect_path, " +
  "status, images, sale_percent, sale_start, sale_end, stock, key_features, option_groups, variants";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/** Clamp a sale percentage to 0–100 with two decimals. */
export function clampSalePercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 100) / 100);
}

export function asOptionGroups(value: unknown): ProductOptionGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((g) => {
    const group = (g ?? {}) as { label?: unknown; options?: unknown; affectsPricing?: unknown };
    const rawOptions = Array.isArray(group.options) ? group.options : [];
    const options = rawOptions.map((o) => {
      const opt = (o ?? {}) as { value?: unknown; price?: unknown; salePercent?: unknown; stock?: unknown };
      return {
        value: typeof opt.value === "string" ? opt.value : "",
        price: typeof opt.price === "number" ? opt.price : null,
        // null = inherit the product-level sale/stock (keeps pre-existing rows,
        // which had neither field, behaving exactly as before).
        salePercent: typeof opt.salePercent === "number" ? clampSalePercent(opt.salePercent) : null,
        stock: typeof opt.stock === "number" ? Math.max(0, Math.round(opt.stock)) : null,
      };
    });
    // Back-compat: older rows had no `affectsPricing`. Treat a group as price-
    // affecting if it was explicitly flagged, or (for legacy data) if any option
    // carried a price override.
    const affectsPricing =
      typeof group.affectsPricing === "boolean"
        ? group.affectsPricing
        : options.some((o) => o.price != null);
    return {
      label: typeof group.label === "string" ? group.label : "",
      affectsPricing,
      options,
    };
  });
}

/**
 * Resolves the product's effective default price/sale/stock. In "Mode 2" — when
 * at least one dropdown affects pricing — the default representation is the first
 * option of each price-affecting group (later groups win), so the listing and
 * cart see the same figures a shopper gets before changing any dropdown. In
 * "Mode 1" the supplied base values are used unchanged.
 */
export function resolveDefaultPricing(
  base: { price: number; salePercent: number; stock: number },
  groups: ProductOptionGroup[],
): { price: number; salePercent: number; stock: number } {
  const groupsWithOptions = groups.filter((g) => g.options.length > 0);

  let { price, salePercent } = base;
  const pricingGroup = groupsWithOptions.find((g) => g.affectsPricing);
  if (pricingGroup) {
    const opt = pricingGroup.options[0];
    if (opt.price != null) price = opt.price;
    if (opt.salePercent != null) salePercent = clampSalePercent(opt.salePercent);
  }

  // Default stock = smallest first-option stock across all dropdowns (each chosen
  // attribute must be in stock); falls back to the base stock when none is set.
  const stockCandidates: number[] = [];
  for (const group of groupsWithOptions) {
    const opt = group.options[0];
    if (opt.stock != null) stockCandidates.push(Math.max(0, Math.round(opt.stock)));
  }
  const stock = stockCandidates.length ? Math.min(...stockCandidates) : Math.max(0, Math.round(base.stock));

  return { price, salePercent, stock };
}

function mapRow(row: Record<string, unknown>): Product {
  return {
    id: Number(row.id),
    slug: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    image_url: (row.image_url as string | null) ?? null,
    price_regular: Number(row.price_regular ?? 0),
    price_sale: row.price_sale == null ? null : Number(row.price_sale),
    is_on_sale: Boolean(row.is_on_sale),
    cost_price: Number(row.cost_price ?? 0),
    weight_grams: Math.max(0, Math.round(Number(row.weight_grams ?? 0))),
    redirect_path: String(row.redirect_path ?? ""),
    status: String(row.status ?? "active"),
    images: asStringArray(row.images),
    sale_percent: Number(row.sale_percent ?? 0),
    sale_start: (row.sale_start as string | null) ?? null,
    sale_end: (row.sale_end as string | null) ?? null,
    stock: Number(row.stock ?? 0),
    key_features: asStringArray(row.key_features),
    option_groups: asOptionGroups(row.option_groups),
    variants: asVariants(row.variants),
  };
}

/** Public product list — active products only, with legacy variations attached. */
export async function listProducts(): Promise<(Product & { variations: ProductVariation[] })[]> {
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "active")
    .order("id", { ascending: true });

  if (productsError) throw productsError;

  const { data: variations, error: variationError } = await supabase
    .from("product_variations")
    .select("id, product_id, label, value, price_regular, price_sale, is_default")
    .order("id", { ascending: true });

  if (variationError) throw variationError;

  const byProduct = new Map<number, ProductVariation[]>();
  for (const variation of (variations ?? []) as ProductVariation[]) {
    const arr = byProduct.get(variation.product_id) ?? [];
    arr.push(variation);
    byProduct.set(variation.product_id, arr);
  }

  return ((products ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const product = mapRow(row);
    return { ...product, variations: byProduct.get(product.id) ?? [] };
  });
}

export async function getProductBySlug(
  slug: string,
): Promise<(Product & { variations: ProductVariation[] }) | null> {
  const products = await listProducts();
  return products.find((p) => p.slug === slug) ?? null;
}

// ----------------------------- Admin CRUD -----------------------------

function toAdminShape(p: Product): AdminProductInput & { id: number } {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    images: p.images,
    price: p.price_regular,
    salePercent: p.sale_percent,
    saleStart: p.sale_start ?? "",
    saleEnd: p.sale_end ?? "",
    stock: p.stock,
    cost: p.cost_price,
    weight: p.weight_grams,
    description: p.description,
    keyFeatures: p.key_features,
    optionGroups: p.option_groups,
    variants: p.variants,
  };
}

/** Admin product list — every product (incl. drafts), in the admin client's shape. */
export async function listProductsForAdmin(): Promise<(AdminProductInput & { id: number })[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("id", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => toAdminShape(mapRow(row)));
}

function buildRow(input: AdminProductInput) {
  const images = asStringArray(input.images);
  const slug = input.slug || "";
  const groups = asOptionGroups(input.optionGroups);
  const baseStock = Math.max(0, Math.round(Number(input.stock) || 0));

  // The stored top-level price/sale describe the product's default representation
  // (Mode 1: the base fields; Mode 2: the first option of the price-affecting
  // dropdown), keeping the store listing and cart reads correct in both modes.
  const resolved = resolveDefaultPricing(
    { price: Number(input.price) || 0, salePercent: clampSalePercent(input.salePercent), stock: baseStock },
    groups,
  );
  const price = resolved.price;
  const pct = clampSalePercent(resolved.salePercent);

  // Inventory: when the product has dropdowns, stock is tracked per combination.
  // Keep only entries for combinations that still exist, and store the sum in the
  // top-level `stock` column so the public listing/"in stock" badge stays correct.
  const validKeys = new Set(buildCombinationKeys(groups));
  const variants = validKeys.size
    ? asVariants(input.variants).filter((v) => validKeys.has(v.key))
    : [];
  const stock = validKeys.size ? totalVariantStock(variants) : baseStock;

  return {
    name: input.name,
    slug,
    description: input.description ?? "",
    status: input.status === "draft" ? "draft" : "active",
    images,
    image_url: images[0] ?? null,
    price_regular: price,
    sale_percent: pct,
    sale_start: input.saleStart || null,
    sale_end: input.saleEnd || null,
    price_sale: pct > 0 ? Number((price * (1 - pct / 100)).toFixed(2)) : null,
    is_on_sale: pct > 0,
    cost_price: Math.max(0, Number(input.cost) || 0),
    weight_grams: Math.max(0, Math.round(Number(input.weight) || 0)),
    stock,
    variants,
    key_features: asStringArray(input.keyFeatures),
    option_groups: groups,
    redirect_path: `/${slug}`,
  };
}

export async function upsertProduct(input: AdminProductInput): Promise<AdminProductInput & { id: number }> {
  const row = buildRow(input);
  if (input.id) {
    const { data, error } = await supabase
      .from("products")
      .update(row)
      .eq("id", input.id)
      .select(PRODUCT_COLUMNS)
      .single();
    if (error) throw error;
    return toAdminShape(mapRow(data as unknown as Record<string, unknown>));
  }
  const { data, error } = await supabase
    .from("products")
    .insert(row)
    .select(PRODUCT_COLUMNS)
    .single();
  if (error) throw error;
  return toAdminShape(mapRow(data as unknown as Record<string, unknown>));
}

export async function deleteProduct(id: number): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

/** Per-unit shipping weight (grams) for the given product ids, keyed by id. */
export async function getProductWeightsGrams(ids: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  const out = new Map<number, number>();
  if (unique.length === 0) return out;
  const { data, error } = await supabase.from("products").select("id, weight_grams").in("id", unique);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ id: number; weight_grams: number | null }>) {
    out.set(Number(row.id), Math.max(0, Math.round(Number(row.weight_grams ?? 0))));
  }
  return out;
}
