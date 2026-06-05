import { ProductOptionGroup, ProductVariantStock } from "../models/types.js";

/**
 * The combination key for a set of selected option values: the values joined by
 * " / " in dropdown order. This is identical to how the cart builds
 * `variation_label`, so combination stock, cart lines, and order items all align.
 */
export function variantKey(values: string[]): string {
  return values.filter(Boolean).join(" / ");
}

/** Parses arbitrary JSON into a clean ProductVariantStock[] (drops malformed entries). */
export function asVariants(value: unknown): ProductVariantStock[] {
  if (!Array.isArray(value)) return [];
  const out: ProductVariantStock[] = [];
  for (const v of value) {
    const row = (v ?? {}) as { key?: unknown; stock?: unknown };
    if (typeof row.key !== "string" || !row.key) continue;
    out.push({ key: row.key, stock: Math.max(0, Math.round(Number(row.stock) || 0)) });
  }
  return out;
}

/** All option-value combinations across the dropdowns (groups with options), in order. */
export function buildCombinationKeys(groups: ProductOptionGroup[]): string[] {
  const valueLists = groups
    .map((g) => g.options.map((o) => o.value).filter(Boolean))
    .filter((vals) => vals.length > 0);
  if (valueLists.length === 0) return [];

  let combos: string[][] = [[]];
  for (const vals of valueLists) {
    const next: string[][] = [];
    for (const combo of combos) {
      for (const val of vals) next.push([...combo, val]);
    }
    combos = next;
  }
  return combos.map((c) => variantKey(c));
}

/** Sum of all combination stocks — used as the product's headline/listing stock. */
export function totalVariantStock(variants: ProductVariantStock[]): number {
  return variants.reduce((sum, v) => sum + (Math.max(0, Math.round(Number(v.stock) || 0))), 0);
}

/**
 * Resolves the available stock for a chosen combination. Prefers the new per-
 * combination `variants`; when those are absent (legacy rows) falls back to the
 * smallest selected-option stock, then to the base stock.
 */
export function resolveCombinationStock(
  variants: ProductVariantStock[],
  groups: ProductOptionGroup[],
  selectedValues: string[],
  baseStock: number,
): number {
  if (variants.length > 0) {
    const match = variants.find((v) => v.key === variantKey(selectedValues));
    return match ? Math.max(0, Math.round(Number(match.stock) || 0)) : 0;
  }

  // Legacy fallback: smallest selected-option stock across dropdowns, else base.
  const groupsWithOptions = groups.filter((g) => g.options.length > 0);
  const candidates: number[] = [];
  for (const group of groupsWithOptions) {
    const opt = group.options.find((o) => selectedValues.includes(o.value)) ?? group.options[0];
    if (opt && opt.stock != null) candidates.push(Math.max(0, Math.round(Number(opt.stock))));
  }
  return candidates.length ? Math.min(...candidates) : Math.max(0, Math.round(baseStock));
}
