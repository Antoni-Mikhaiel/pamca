import { supabase } from "../lib/supabase.js";
import { deletePaymentLink } from "./squareService.js";

/** Checkouts left unpaid this long are abandoned (Square links don't expire on their own). */
export const ABANDONED_CHECKOUT_DAYS = 7;
/** The cart cookie lives 30 days; rows untouched for longer than this can never be used again. */
export const STALE_CART_DAYS = 45;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/**
 * Deletes checkouts that were started but never paid. Each order's Square Payment
 * Link is deleted first; if that fails the order is kept (and retried next run) so
 * a link can never be paid after its order is gone. The delete is conditional on
 * the order still being pending, in case it was paid in the meantime.
 */
export async function expireAbandonedCheckouts(): Promise<{ deleted: number; kept: number }> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, square_payment_link_id")
    .eq("status", "pending")
    .lt("created_at", daysAgo(ABANDONED_CHECKOUT_DAYS))
    .limit(200);
  if (error) throw error;

  let deleted = 0;
  let kept = 0;
  for (const row of (data ?? []) as Array<{ id: string; square_payment_link_id: string | null }>) {
    if (row.square_payment_link_id) {
      const gone = await deletePaymentLink(row.square_payment_link_id).catch(() => false);
      if (!gone) {
        kept++;
        continue;
      }
    }
    const { data: removed, error: delError } = await supabase
      .from("orders")
      .delete()
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (delError) throw delError;
    deleted += removed?.length ?? 0;
  }
  return { deleted, kept };
}

/** Removes cart lines that haven't been touched since their cookie expired. */
export async function pruneStaleCarts(): Promise<number> {
  const { data, error } = await supabase.from("cart_items").delete().lt("updated_at", daysAgo(STALE_CART_DAYS)).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Removes rate-limit counters whose windows (at most an hour) ended long ago. */
export async function pruneRateLimits(): Promise<number> {
  const { data, error } = await supabase.from("rate_limits").delete().lt("window_start", daysAgo(1)).select("key");
  if (error) throw error;
  return data?.length ?? 0;
}
