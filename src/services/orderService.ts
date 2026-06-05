import { randomInt } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { CartItem, CustomerDetails, OrderRecord } from "../models/types.js";
import { asVariants } from "../lib/variants.js";

export interface CreatedOrder {
  id: string;
  purchaseId: string;
  totalCents: number;
  currency: string;
}

function toCents(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

/** A random 6-digit reference (kept as a zero-padded string). */
function generatePurchaseId(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Snapshots the current cart into a pending order (+ order_items), stamping the
 * delivery details and a unique 6-digit purchase id. The snapshot is intentionally
 * a copy, not a join, so the order stays accurate even if a product is later edited
 * or deleted. Amounts are stored in integer cents.
 */
export async function createPendingOrder(params: {
  cartToken: string;
  items: CartItem[];
  currency: string;
  customer: CustomerDetails;
  userId?: string | null;
}): Promise<CreatedOrder> {
  const { cartToken, items, currency, customer, userId } = params;

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

  // Insert with a fresh purchase id, retrying on the (rare) unique-index clash.
  let created: { id: string; purchase_id: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        cart_token: cartToken,
        user_id: userId ?? null,
        status: "pending",
        currency,
        subtotal_cents: totalCents,
        total_cents: totalCents,
        purchase_id: generatePurchaseId(),
        customer_first_name: customer.firstName,
        customer_last_name: customer.lastName,
        customer_email: customer.email,
        customer_phone: customer.phone,
        customer_address: customer.address,
      })
      .select("id, purchase_id")
      .single();

    if (!error) {
      created = data as { id: string; purchase_id: string };
      break;
    }
    if ((error as { code?: string }).code === "23505") continue; // purchase_id collision
    throw error;
  }
  if (!created) throw new Error("Could not generate a unique purchase ID");

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(lineRows.map((r) => ({ ...r, order_id: created!.id })));
  if (itemsError) throw itemsError;

  return { id: created.id, purchaseId: created.purchase_id, totalCents, currency };
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
 * Returns the order id + cart_token so the caller can apply stock and clear the
 * cart, or null if the order is unknown or was already marked paid.
 */
export async function markOrderPaidBySquareOrderId(
  squareOrderId: string,
  squarePaymentId: string,
): Promise<{ orderId: string; cartToken: string | null } | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, cart_token, status, total_cents")
    .eq("square_order_id", squareOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as { id: string; cart_token: string | null; status: string; total_cents: number };
  if (row.status === "paid") return null;

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "paid",
      square_payment_id: squarePaymentId,
      // Record the charge so refunds can be issued against it later.
      payments: [{ square_payment_id: squarePaymentId, amount_cents: Number(row.total_cents) || 0, refunded_cents: 0 }],
    })
    .eq("id", row.id);
  if (updateError) throw updateError;

  return { orderId: row.id, cartToken: row.cart_token };
}

/**
 * Decrements product stock for a paid order exactly once. The decrement is
 * "claimed" by atomically flipping `stock_applied` false→true, so duplicate or
 * retried webhook deliveries can never double-deduct.
 */
export async function applyStockForOrder(orderId: string): Promise<void> {
  const { data, error } = await supabase
    .from("orders")
    .update({ stock_applied: true })
    .eq("id", orderId)
    .eq("stock_applied", false)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) return; // already applied by an earlier event

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("product_id, variation_label, quantity")
    .eq("order_id", orderId);
  if (itemsError) throw itemsError;

  for (const item of (items ?? []) as Array<{ product_id: number | null; variation_label: string | null; quantity: number }>) {
    if (item.product_id == null) continue;
    await adjustProductStock(item.product_id, item.variation_label, item.quantity);
  }
}

/**
 * Adjusts a product's stock by a *sold delta*: positive sells (decrements),
 * negative restocks (increments). When the product tracks per-combination stock,
 * the matching combination (identified by the order item's variation label) is
 * adjusted in `variants` and the top-level `stock` is recomputed as their sum;
 * otherwise the base `stock` column is adjusted. Never goes below zero. Exported
 * so the order-edit/refund flow can sell added units and restock removed ones.
 */
export async function adjustProductStock(
  productId: number,
  variationLabel: string | null,
  soldDelta: number,
): Promise<void> {
  if (!soldDelta) return;
  const { data: product, error } = await supabase
    .from("products")
    .select("id, stock, variants")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  if (!product) return;

  const prod = product as { stock: number; variants: unknown };
  const variants = asVariants(prod.variants);

  // No per-combination inventory → adjust the base stock column.
  if (variants.length === 0) {
    const newStock = Math.max(0, (Number(prod.stock) || 0) - soldDelta);
    const { error: updateError } = await supabase.from("products").update({ stock: newStock }).eq("id", productId);
    if (updateError) throw updateError;
    return;
  }

  const key = (variationLabel ?? "").trim();
  const newVariants = variants.map((v) =>
    v.key === key ? { ...v, stock: Math.max(0, v.stock - soldDelta) } : v,
  );
  const newStock = newVariants.reduce((sum, v) => sum + v.stock, 0);

  const { error: updateError } = await supabase
    .from("products")
    .update({ variants: newVariants, stock: newStock })
    .eq("id", productId);
  if (updateError) throw updateError;
}

/** Edit allowed within this window from order creation; refund within the longer one. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;

const ORDER_SELECT =
  "id, purchase_id, status, currency, total_cents, customer_first_name, customer_last_name, " +
  "customer_email, customer_phone, customer_address, created_at, uneditable, completed_at, refunded_at, amount_refunded_cents, " +
  "order_items(id, product_id, product_name, variation_label, unit_price_cents, quantity, line_total_cents)";

export function orderAgeMs(createdAt: string): number {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

export function isOrderEditable(row: { status: string; uneditable: boolean; refunded_at: string | null; created_at: string }): boolean {
  return row.status === "paid" && !row.uneditable && !row.refunded_at && orderAgeMs(row.created_at) < EDIT_WINDOW_MS;
}

export function isOrderRefundable(row: {
  status: string;
  refunded_at: string | null;
  created_at: string;
  completed_at: string | null;
}): boolean {
  // A completed (fulfilled) order can no longer be refunded online, even inside the window.
  return (
    row.status === "paid" &&
    !row.refunded_at &&
    !row.completed_at &&
    orderAgeMs(row.created_at) < REFUND_WINDOW_MS
  );
}

function mapOrder(row: Record<string, unknown>): OrderRecord {
  const items = Array.isArray(row.order_items) ? (row.order_items as Record<string, unknown>[]) : [];
  const status = String(row.status ?? "pending");
  const uneditable = Boolean(row.uneditable);
  const refundedAt = (row.refunded_at as string | null) ?? null;
  const completedAt = (row.completed_at as string | null) ?? null;
  const createdAt = String(row.created_at ?? "");
  return {
    id: String(row.id),
    purchase_id: (row.purchase_id as string | null) ?? null,
    status,
    currency: String(row.currency ?? "CAD"),
    total_cents: Number(row.total_cents ?? 0),
    customer_first_name: (row.customer_first_name as string | null) ?? null,
    customer_last_name: (row.customer_last_name as string | null) ?? null,
    customer_email: (row.customer_email as string | null) ?? null,
    customer_phone: (row.customer_phone as string | null) ?? null,
    customer_address: (row.customer_address as string | null) ?? null,
    created_at: createdAt,
    uneditable,
    completed_at: completedAt,
    amount_refunded_cents: Number(row.amount_refunded_cents ?? 0),
    editable: isOrderEditable({ status, uneditable, refunded_at: refundedAt, created_at: createdAt }),
    refundable: isOrderRefundable({ status, refunded_at: refundedAt, created_at: createdAt, completed_at: completedAt }),
    items: items.map((it) => ({
      id: it.id != null ? String(it.id) : undefined,
      product_id: it.product_id == null ? null : Number(it.product_id),
      product_name: String(it.product_name ?? ""),
      variation_label: (it.variation_label as string | null) ?? null,
      unit_price_cents: Number(it.unit_price_cents ?? 0),
      quantity: Number(it.quantity ?? 0),
      line_total_cents: Number(it.line_total_cents ?? 0),
    })),
  };
}

/** Orders belonging to a signed-in user, newest first. */
export async function listOrdersForUser(userId: string): Promise<OrderRecord[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapOrder);
}

/**
 * Guest order lookup: matches a 6-digit purchase id AND the order's phone number
 * (normalized `+1` + 10 digits), so the id alone can't expose someone else's order.
 */
export async function lookupOrder(purchaseId: string, normalizedPhone: string): Promise<OrderRecord | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("purchase_id", purchaseId)
    .eq("customer_phone", normalizedPhone)
    .maybeSingle();
  if (error) throw error;
  return data ? mapOrder(data as unknown as Record<string, unknown>) : null;
}

/** Every order (admin view), newest first. */
export async function listAllOrders(): Promise<OrderRecord[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapOrder);
}

/** A single order in the client-facing shape (with computed editable/refundable). */
export async function getOrderRecordById(orderId: string): Promise<OrderRecord | null> {
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data ? mapOrder(data as unknown as Record<string, unknown>) : null;
}

export interface OrderPaymentEntry {
  square_payment_id: string;
  amount_cents: number;
  refunded_cents: number;
}

export interface FullOrderItem {
  id: string;
  product_id: number | null;
  variation_id: number | null;
  product_name: string;
  variation_label: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export interface FullOrder {
  id: string;
  user_id: string | null;
  cart_token: string | null;
  purchase_id: string | null;
  status: string;
  currency: string;
  total_cents: number;
  uneditable: boolean;
  completed_at: string | null;
  refunded_at: string | null;
  amount_refunded_cents: number;
  payments: OrderPaymentEntry[];
  created_at: string;
  customer: CustomerDetails;
  items: FullOrderItem[];
}

const FULL_ORDER_SELECT =
  "id, user_id, cart_token, purchase_id, status, currency, total_cents, uneditable, completed_at, refunded_at, " +
  "amount_refunded_cents, payments, created_at, customer_first_name, customer_last_name, customer_email, " +
  "customer_phone, customer_address, " +
  "order_items(id, product_id, variation_id, product_name, variation_label, unit_price_cents, quantity, line_total_cents)";

/** Loads an order with everything the edit/refund flow needs (raw, not display-shaped). */
export async function getFullOrder(orderId: string): Promise<FullOrder | null> {
  const { data, error } = await supabase.from("orders").select(FULL_ORDER_SELECT).eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;

  const items = Array.isArray(row.order_items) ? (row.order_items as Record<string, unknown>[]) : [];
  const payments = Array.isArray(row.payments) ? (row.payments as Record<string, unknown>[]) : [];

  return {
    id: String(row.id),
    user_id: (row.user_id as string | null) ?? null,
    cart_token: (row.cart_token as string | null) ?? null,
    purchase_id: (row.purchase_id as string | null) ?? null,
    status: String(row.status ?? "pending"),
    currency: String(row.currency ?? "CAD"),
    total_cents: Number(row.total_cents ?? 0),
    uneditable: Boolean(row.uneditable),
    completed_at: (row.completed_at as string | null) ?? null,
    refunded_at: (row.refunded_at as string | null) ?? null,
    amount_refunded_cents: Number(row.amount_refunded_cents ?? 0),
    payments: payments.map((p) => ({
      square_payment_id: String(p.square_payment_id ?? ""),
      amount_cents: Number(p.amount_cents ?? 0),
      refunded_cents: Number(p.refunded_cents ?? 0),
    })),
    created_at: String(row.created_at ?? ""),
    customer: {
      firstName: String(row.customer_first_name ?? ""),
      lastName: String(row.customer_last_name ?? ""),
      email: String(row.customer_email ?? ""),
      phone: String(row.customer_phone ?? ""),
      address: String(row.customer_address ?? ""),
    },
    items: items.map((it) => ({
      id: String(it.id),
      product_id: it.product_id == null ? null : Number(it.product_id),
      variation_id: it.variation_id == null ? null : Number(it.variation_id),
      product_name: String(it.product_name ?? ""),
      variation_label: (it.variation_label as string | null) ?? null,
      unit_price_cents: Number(it.unit_price_cents ?? 0),
      quantity: Number(it.quantity ?? 0),
      line_total_cents: Number(it.line_total_cents ?? 0),
    })),
  };
}

/**
 * Admin early-lock toggle. Only permitted within the edit window; the caller is
 * expected to have verified admin rights. Returns the updated display record.
 */
export async function setOrderUneditable(orderId: string, value: boolean): Promise<OrderRecord | null> {
  const { error } = await supabase.from("orders").update({ uneditable: value }).eq("id", orderId);
  if (error) throw error;
  return getOrderRecordById(orderId);
}

/**
 * Admin "Complete Order" toggle — stamps/clears `completed_at`. This is purely a
 * fulfillment/communication marker shown to the customer; it does not affect edit
 * or refund eligibility. Returns the updated display record.
 */
export async function setOrderCompleted(orderId: string, value: boolean): Promise<OrderRecord | null> {
  const { error } = await supabase
    .from("orders")
    .update({ completed_at: value ? new Date().toISOString() : null })
    .eq("id", orderId);
  if (error) throw error;
  return getOrderRecordById(orderId);
}

/** Appends a successful charge to an order's payments ledger and bumps its total. */
export async function recordPaymentAndTotal(
  orderId: string,
  payment: OrderPaymentEntry,
  newTotalCents: number,
): Promise<void> {
  const { data, error } = await supabase.from("orders").select("payments").eq("id", orderId).maybeSingle();
  if (error) throw error;
  const existing = Array.isArray((data as { payments?: unknown })?.payments)
    ? ((data as { payments: OrderPaymentEntry[] }).payments)
    : [];
  const { error: updateError } = await supabase
    .from("orders")
    .update({ payments: [...existing, payment], total_cents: newTotalCents })
    .eq("id", orderId);
  if (updateError) throw updateError;
}

/** Sets an order's total (used when an edit is applied without a new charge). */
export async function updateOrderTotal(orderId: string, totalCents: number): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ subtotal_cents: totalCents, total_cents: totalCents })
    .eq("id", orderId);
  if (error) throw error;
}

/** Replaces an order's line items wholesale (used when an edit is applied). */
export async function replaceOrderItems(orderId: string, items: Omit<FullOrderItem, "id">[]): Promise<void> {
  const { error: delError } = await supabase.from("order_items").delete().eq("order_id", orderId);
  if (delError) throw delError;
  if (items.length === 0) return;
  const { error } = await supabase
    .from("order_items")
    .insert(items.map((it) => ({ ...it, order_id: orderId })));
  if (error) throw error;
}

/**
 * Persists an updated payments ledger (with bumped `refunded_cents`) and the new
 * `amount_refunded_cents` total. When `markFullyRefunded` is set, the order is moved
 * to the 'refunded' state and stamped.
 */
export async function recordRefund(
  orderId: string,
  payments: OrderPaymentEntry[],
  markFullyRefunded: boolean,
): Promise<void> {
  const update: Record<string, unknown> = {
    payments,
    amount_refunded_cents: payments.reduce((s, p) => s + p.refunded_cents, 0),
  };
  if (markFullyRefunded) {
    update.status = "refunded";
    update.refunded_at = new Date().toISOString();
  }
  const { error } = await supabase.from("orders").update(update).eq("id", orderId);
  if (error) throw error;
}
