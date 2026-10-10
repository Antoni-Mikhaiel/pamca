import { supabase } from "../lib/supabase.js";

const HST_SETTING_KEY = "hst_rate";
const DEFAULT_HST_PERCENT = 13;

// The rate is read on every cart/checkout request but changes almost never, so a
// warm function instance remembers it briefly instead of re-querying each time.
const HST_CACHE_TTL_MS = 60 * 1000;
let hstCache: { value: number; at: number } | null = null;

/**
 * Get the current HST percent from the site_content table.
 * If not set, returns the default (13%).
 */
export async function getHSTPercent(): Promise<number> {
  if (hstCache && Date.now() - hstCache.at < HST_CACHE_TTL_MS) return hstCache.value;

  const { data, error } = await supabase
    .from("site_content")
    .select("value")
    .eq("key", HST_SETTING_KEY)
    .maybeSingle();

  // A failed read falls back to the default but isn't cached, so the next request retries.
  if (error) return DEFAULT_HST_PERCENT;

  const value = (data?.value as Record<string, unknown> | undefined)?.percent;
  const percent = typeof value === "number" ? Math.max(0, Math.min(100, value)) : DEFAULT_HST_PERCENT;
  hstCache = { value: percent, at: Date.now() };
  return percent;
}

/**
 * Set the HST percent in the site_content table.
 * Percent should be between 0 and 100.
 */
export async function setHSTPercent(percent: number): Promise<number> {
  // Number.isFinite (not `|| default`) so a deliberate 0% rate is kept.
  const n = Number(percent);
  const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? n : DEFAULT_HST_PERCENT));

  const { error } = await supabase
    .from("site_content")
    .upsert(
      {
        key: HST_SETTING_KEY,
        value: { percent: clamped },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

  if (error) {
    throw error;
  }

  hstCache = { value: clamped, at: Date.now() };
  return clamped;
}

/**
 * Calculate tax amount in cents from a subtotal in cents.
 */
export function calculateTaxCents(subtotalCents: number, hstPercent: number): number {
  return Math.round((subtotalCents * hstPercent) / 100);
}
