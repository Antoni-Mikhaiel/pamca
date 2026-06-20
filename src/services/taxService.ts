import { supabase } from "../lib/supabase.js";

const HST_SETTING_KEY = "hst_rate";
const DEFAULT_HST_PERCENT = 13;

/**
 * Get the current HST percent from the site_content table.
 * If not set, returns the default (13%).
 */
export async function getHSTPercent(): Promise<number> {
  const { data, error } = await supabase
    .from("site_content")
    .select("value")
    .eq("key", HST_SETTING_KEY)
    .single();

  if (error || !data) {
    return DEFAULT_HST_PERCENT;
  }

  const value = (data.value as Record<string, unknown>)?.percent;
  const percent = typeof value === "number" ? value : DEFAULT_HST_PERCENT;
  return Math.max(0, Math.min(100, percent)); // Clamp to 0-100
}

/**
 * Set the HST percent in the site_content table.
 * Percent should be between 0 and 100.
 */
export async function setHSTPercent(percent: number): Promise<number> {
  const clamped = Math.max(0, Math.min(100, Number(percent) || DEFAULT_HST_PERCENT));

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

  return clamped;
}

/**
 * Calculate tax amount in cents from a subtotal in cents.
 */
export function calculateTaxCents(subtotalCents: number, hstPercent: number): number {
  return Math.round((subtotalCents * hstPercent) / 100);
}
