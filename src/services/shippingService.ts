import { CartItem, ShippingLine } from "../models/types.js";
import { getProductShippingInfo, ProductShippingInfo } from "./productService.js";
import { getShippingRates, getDefaultItemWeightGrams, ShippingRate } from "./canadaPostService.js";

/**
 * Per-product shipping: a product either ships via Canada Post (weight-based rate) or
 * via a third-party courier (a flat price the admin sets). A cart's shipping is the
 * combined Canada Post rate for all its Canada-Post items (one parcel, by weight) plus
 * one flat line for each third-party product (charged once per line, any quantity).
 */

/** Combined parcel weight (kg) for the given items, using the per-unit product weight. */
function weightKgOf(items: CartItem[], info: Map<number, ProductShippingInfo>): number {
  const fallbackG = getDefaultItemWeightGrams();
  let grams = 0;
  for (const item of items) {
    const perUnit = info.get(item.product_id)?.weightGrams || fallbackG;
    grams += perUnit * (Number(item.quantity) || 0);
  }
  return grams / 1000;
}

function splitByMethod(items: CartItem[], info: Map<number, ProductShippingInfo>) {
  const canadaPost = items.filter((i) => (info.get(i.product_id)?.method ?? "canada_post") !== "third_party");
  const thirdParty = items.filter((i) => info.get(i.product_id)?.method === "third_party");
  return { canadaPost, thirdParty };
}

/** One flat 'third_party' line per third-party product (once per line, regardless of qty). */
function thirdPartyLines(items: CartItem[], info: Map<number, ProductShippingInfo>): ShippingLine[] {
  return items.map((i) => ({
    method: "third_party",
    label: i.product_name,
    cents: Math.round((info.get(i.product_id)?.flatPrice ?? 0) * 100),
  }));
}

/** Display name for a cart line (product name + variation label when present). */
function cartItemLabel(i: CartItem): string {
  return i.variation_label ? `${i.product_name} (${i.variation_label})` : i.product_name;
}

export interface CartShippingQuote {
  /** Canada Post service options for the CP portion (empty when there are no CP items). */
  canadaPostRates: ShippingRate[];
  /** Names of the items that ship by Canada Post (all covered by the chosen CP service). */
  canadaPostItems: string[];
  /** One flat line per third-party item. */
  thirdPartyLines: ShippingLine[];
  /** True when the cart has Canada Post items — i.e. a Canada Post service must be chosen. */
  hasCanadaPost: boolean;
  /** Sum of the third-party flat lines (cents). */
  thirdPartyCents: number;
}

/**
 * Quotes shipping options for the cart: the Canada Post service choices (for the CP
 * items) plus the fixed third-party flat lines. Used by the checkout rates endpoint so
 * the shopper can pick a Canada Post service and see the courier fees.
 */
export async function quoteCartShipping(items: CartItem[], postalCode: string): Promise<CartShippingQuote> {
  const info = await getProductShippingInfo(items.map((i) => i.product_id));
  const { canadaPost, thirdParty } = splitByMethod(items, info);

  const canadaPostRates = canadaPost.length
    ? await getShippingRates({ destinationPostalCode: postalCode, weightKg: weightKgOf(canadaPost, info) })
    : [];
  const tpLines = thirdPartyLines(thirdParty, info);

  return {
    canadaPostRates,
    canadaPostItems: canadaPost.map(cartItemLabel),
    thirdPartyLines: tpLines,
    hasCanadaPost: canadaPost.length > 0,
    thirdPartyCents: tpLines.reduce((s, l) => s + l.cents, 0),
  };
}

export interface ResolvedCartShipping {
  /** One combined Canada Post line (when applicable) + a line per third-party item. */
  breakdown: ShippingLine[];
  totalCents: number;
  /** Chosen Canada Post service (null when the cart has no Canada Post items). */
  cpServiceCode: string | null;
  cpServiceName: string | null;
}

/**
 * Resolves the final shipping for an order given the shopper's chosen Canada Post
 * service. Re-quotes server-side so the price can't be tampered with; falls back to the
 * cheapest Canada Post option when the requested code is no longer offered.
 */
export async function resolveCartShipping(
  items: CartItem[],
  postalCode: string,
  requestedServiceCode: string,
): Promise<ResolvedCartShipping> {
  const quote = await quoteCartShipping(items, postalCode);
  const breakdown: ShippingLine[] = [];
  let cpServiceCode: string | null = null;
  let cpServiceName: string | null = null;

  if (quote.canadaPostRates.length) {
    const chosen =
      quote.canadaPostRates.find((r) => r.serviceCode === requestedServiceCode) ?? quote.canadaPostRates[0];
    breakdown.push({ method: "canada_post", label: chosen.serviceName, cents: chosen.priceCents });
    cpServiceCode = chosen.serviceCode;
    cpServiceName = chosen.serviceName;
  }
  breakdown.push(...quote.thirdPartyLines);

  return {
    breakdown,
    totalCents: breakdown.reduce((s, l) => s + l.cents, 0),
    cpServiceCode,
    cpServiceName,
  };
}
