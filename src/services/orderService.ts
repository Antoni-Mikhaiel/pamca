import { supabase } from "../lib/supabase";
import { CartItem } from "../models/types";

export interface CreatedOrder {
  id: string;
  totalCents: number;
  currency: string;
}

function toCents(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

/**
 * Snapshots the current cart into a pending order (+ order_items). The snapshot
 * is intentionally a copy, not a join, so the order remains accurate even if the
 * product is later edited or deleted. Amounts are stored in integer cents.
 */
export async function createPendingOrder(params: {
  cartToken: string;
  items: CartItem[];
  currency: string;
}): Promise<CreatedOrder> {
  const { cartToken, items, currency } = params;

  const lineRows = items.map((item) => {
    const unitCents = toCents(item.unit_price);
    return {
      product_id: item.product_id,
      variation_id: item.variation_id,
      product_name: item.product_name,
      variation_label: item.variation_label,
      unit_price_cents: unitCents,
      quantity: item.quantity,
      line_total_cents: unitCents * item.quantity,
    };
  });
  const totalCents = lineRows.reduce((sum, r) => sum + r.line_total_cents, 0);

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      cart_token: cartToken,
      status: "pending",
      currency,
      subtotal_cents: totalCents,
      total_cents: totalCents,
    })
    .select("id")
    .single();
  if (error) throw error;

  const orderId = (order as { id: string }).id;

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(lineRows.map((r) => ({ ...r, order_id: orderId })));
  if (itemsError) throw itemsError;

  return { id: orderId, totalCents, currency };
}

/** Records the Square identifiers once the payment link has been created. */
export async function attachSquareDetails(
  orderId: string,
  details: { paymentLinkId?: string; squareOrderId?: string | null; checkoutUrl?: string },
): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({
      square_payment_link_id: details.paymentLinkId ?? null,
      square_order_id: details.squareOrderId ?? null,
      checkout_url: details.checkoutUrl ?? null,
    })
    .eq("id", orderId);
  if (error) throw error;
}

/**
 * Flips an order to 'paid' (idempotently) when its Square payment completes.
 * Returns the order's cart_token so the caller can clear the cart, or null if
 * the order is unknown or was already marked paid.
 */
export async function markOrderPaidBySquareOrderId(
  squareOrderId: string,
  squarePaymentId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, cart_token, status")
    .eq("square_order_id", squareOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as { id: string; cart_token: string | null; status: string };
  if (row.status === "paid") return null;

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "paid", square_payment_id: squarePaymentId })
    .eq("id", row.id);
  if (updateError) throw updateError;

  return row.cart_token;
}
