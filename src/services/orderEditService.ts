import { supabase } from "../lib/supabase.js";
import { resolveProductLine, SelectedOption } from "./cartService.js";
import {
  FullOrder,
  FullOrderItem,
  OrderPaymentEntry,
  adjustProductStock,
  getFullOrder,
  getOrderRecordById,
  isOrderEditable,
  isOrderRefundable,
  recordPaymentAndTotal,
  recordRefund,
  replaceOrderItems,
  updateOrderTotal,
} from "./orderService.js";
import {
  createPaymentLink,
  refundPayment,
  getSquareCurrency,
  isSquareConfigured,
  SquareLineItem,
} from "./squareService.js";
import { sendRefundAdminEmail } from "./emailService.js";
import { calculateTaxCents } from "./taxService.js";

const SITE_URL = (process.env.SITE_URL ?? "").replace(/\/$/, "");

// The client describes an edit as: reduced quantities on existing lines (0 = remove)
// plus newly added products. Existing lines can only be decreased — to add more of
// something, send it under `additions` (priced at the current catalog price). This
// keeps every order line single-priced: already-paid units stay at the paid price,
// new units bill at today's price.
export interface OrderEditRequest {
  existing?: Array<{ orderItemId: string; quantity: number }>;
  additions?: Array<{ slug: string; options?: SelectedOption[]; quantity: number }>;
}

type NewItem = Omit<FullOrderItem, "id">;

export interface EditDiffLine {
  kind: "add" | "remove";
  label: string;
  quantity: number;
  amountCents: number;
}

export interface EditPlan {
  newItems: NewItem[];
  newSubtotalCents: number;
  newTaxCents: number;
  newTotalCents: number;
  chargeCents: number;
  refundCents: number;
  /** charge − refund. >0 the customer owes more; <0 they're owed a refund; 0 even. */
  deltaCents: number;
  diff: EditDiffLine[];
}

function keyOf(productId: number | null, variationLabel: string | null): string {
  return `${productId ?? "x"}|${variationLabel ?? ""}`;
}

/**
 * Builds the resulting item set, the money breakdown, and a human-readable diff for
 * an edit. Throws on invalid input (unknown line, increasing an existing line,
 * insufficient stock for an addition). Prices are recomputed server-side.
 */
export async function buildEditPlan(order: FullOrder, edit: OrderEditRequest): Promise<EditPlan> {
  const existingOverrides = new Map<string, number>();
  for (const e of edit.existing ?? []) {
    const q = Math.max(0, Math.floor(Number(e.quantity)));
    existingOverrides.set(String(e.orderItemId), q);
  }

  const newItems: NewItem[] = [];
  const diff: EditDiffLine[] = [];
  let refundCents = 0;

  for (const item of order.items) {
    const overridden = existingOverrides.has(item.id);
    const newQty = overridden ? (existingOverrides.get(item.id) as number) : item.quantity;
    if (newQty > item.quantity) {
      throw new Error("To add more of an item, add it as a new line instead of increasing the existing one.");
    }
    if (newQty < item.quantity) {
      const removedQty = item.quantity - newQty;
      refundCents += removedQty * item.unit_price_cents;
      diff.push({
        kind: "remove",
        label: item.product_name + (item.variation_label ? ` (${item.variation_label})` : ""),
        quantity: removedQty,
        amountCents: removedQty * item.unit_price_cents,
      });
    }
    if (newQty > 0) {
      newItems.push({
        product_id: item.product_id,
        variation_id: item.variation_id,
        product_name: item.product_name,
        variation_label: item.variation_label,
        unit_price_cents: item.unit_price_cents,
        quantity: newQty,
        line_total_cents: item.unit_price_cents * newQty,
      });
    }
  }

  let chargeCents = 0;
  for (const add of edit.additions ?? []) {
    const qty = Math.max(0, Math.floor(Number(add.quantity)));
    if (qty <= 0) continue;
    const resolved = await resolveProductLine(add.slug, Array.isArray(add.options) ? add.options : []);
    if (!resolved.ok) {
      throw new Error(resolved.reason === "sold_out" ? "An item you added is sold out." : "An item you added no longer exists.");
    }
    const line = resolved.line;
    if (qty > line.stock) {
      throw new Error(`Only ${line.stock} of ${line.productName} ${line.variationLabel ? `(${line.variationLabel}) ` : ""}in stock.`);
    }
    const unitCents = Math.round(line.unitPrice * 100);
    chargeCents += unitCents * qty;
    diff.push({
      kind: "add",
      label: line.productName + (line.variationLabel ? ` (${line.variationLabel})` : ""),
      quantity: qty,
      amountCents: unitCents * qty,
    });
    newItems.push({
      product_id: line.productId,
      variation_id: null,
      product_name: line.productName,
      variation_label: line.variationLabel,
      unit_price_cents: unitCents,
      quantity: qty,
      line_total_cents: unitCents * qty,
    });
  }

  if (newItems.length === 0) {
    throw new Error("An order can't be emptied — cancel it with a full refund instead.");
  }

  const newSubtotalCents = newItems.reduce((s, i) => s + i.line_total_cents, 0);
  const newTaxCents = calculateTaxCents(newSubtotalCents, order.hst_percent);
  const newTotalCents = newSubtotalCents + newTaxCents;
  // The money the customer pays/receives is the change in the tax-inclusive total,
  // not just the subtotal difference — otherwise the tax on added/removed units would
  // never be charged or refunded. (chargeCents/refundCents remain the pre-tax line
  // amounts, used only for the itemized diff shown to the shopper.)
  const deltaCents = newTotalCents - order.total_cents;
  return { newItems, newSubtotalCents, newTaxCents, newTotalCents, chargeCents, refundCents, deltaCents, diff };
}

/** Stock changes needed to move from `oldItems` to `newItems` (positive = sell more). */
function stockDeltas(
  oldItems: Array<{ product_id: number | null; variation_label: string | null; quantity: number }>,
  newItems: Array<{ product_id: number | null; variation_label: string | null; quantity: number }>,
): Array<{ productId: number; variationLabel: string | null; soldDelta: number }> {
  const map = new Map<string, { productId: number; variationLabel: string | null; delta: number }>();
  const add = (pid: number | null, vl: string | null, q: number, sign: number) => {
    if (pid == null) return;
    const k = keyOf(pid, vl);
    const cur = map.get(k) ?? { productId: pid, variationLabel: vl, delta: 0 };
    cur.delta += sign * q;
    map.set(k, cur);
  };
  oldItems.forEach((i) => add(i.product_id, i.variation_label, i.quantity, -1));
  newItems.forEach((i) => add(i.product_id, i.variation_label, i.quantity, +1));
  return Array.from(map.values())
    .filter((v) => v.delta !== 0)
    .map((v) => ({ productId: v.productId, variationLabel: v.variationLabel, soldDelta: v.delta }));
}

async function applyItemsAndStock(order: FullOrder, newItems: NewItem[]): Promise<void> {
  for (const d of stockDeltas(order.items, newItems)) {
    await adjustProductStock(d.productId, d.variationLabel, d.soldDelta);
  }
  await replaceOrderItems(order.id, newItems);
}

/** Refunds `targetCents` across an order's payments, mutating the ledger entries. */
async function refundAcrossPayments(
  payments: OrderPaymentEntry[],
  targetCents: number,
): Promise<{ payments: OrderPaymentEntry[]; refundedCents: number }> {
  const ledger = payments.map((p) => ({ ...p }));
  let remaining = Math.round(targetCents);
  for (const p of ledger) {
    if (remaining <= 0) break;
    const available = p.amount_cents - p.refunded_cents;
    const take = Math.min(remaining, available);
    if (take <= 0) continue;
    await refundPayment({ paymentId: p.square_payment_id, amountCents: take, reason: "PAMCA order adjustment" });
    p.refunded_cents += take;
    remaining -= take;
  }
  return { payments: ledger, refundedCents: Math.round(targetCents) - remaining };
}

export interface CommitResult {
  /** Set when the edit needs an extra payment — the client should redirect here. */
  redirectUrl?: string;
  applied?: boolean;
  refundedCents?: number;
  chargeCents?: number;
}

/**
 * Commits an edit. When the customer owes more, the change is staged and a Square
 * payment link for the difference is returned (the edit applies on the webhook).
 * When they're owed money it's refunded and applied immediately; an even swap is
 * applied immediately with no money movement.
 */
export async function commitEdit(order: FullOrder, edit: OrderEditRequest): Promise<CommitResult> {
  if (!isOrderEditable(order)) throw new Error("This order can no longer be edited.");
  const plan = await buildEditPlan(order, edit);

  if (plan.deltaCents > 0) {
    if (!isSquareConfigured()) throw new Error("Online payment is not available right now.");

    // Replace any prior pending edit so only one top-up can be outstanding.
    await supabase.from("order_edits").delete().eq("order_id", order.id).eq("status", "pending");

    const { data: editRow, error } = await supabase
      .from("order_edits")
      .insert({ order_id: order.id, status: "pending", delta_cents: plan.deltaCents, new_items: plan.newItems })
      .select("id")
      .single();
    if (error) throw error;
    const editId = (editRow as { id: string }).id;

    const lineItems: SquareLineItem[] = [
      { name: `Order #${order.purchase_id ?? ""} changes`, quantity: 1, amountCents: plan.deltaCents },
    ];
    const redirect = SITE_URL ? `${SITE_URL}/?order=edit-success&pid=${order.purchase_id ?? ""}` : undefined;
    // Construct the full address line for Square from separate fields
    const addressLine = order.customer.streetNumber && order.customer.streetName
      ? `${order.customer.streetNumber} ${order.customer.streetName}, ${order.customer.province} ${order.customer.postalCode}`
      : undefined;
    const link = await createPaymentLink({
      lineItems,
      redirectUrl: redirect,
      referenceId: editId,
      note: "PAMCA order change",
      buyer: {
        email: order.customer.email,
        phone: order.customer.phone,
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        addressLine1: addressLine,
      },
    });

    const { error: updErr } = await supabase
      .from("order_edits")
      .update({ square_order_id: link.orderId, checkout_url: link.url })
      .eq("id", editId);
    if (updErr) throw updErr;

    return { redirectUrl: link.url, chargeCents: plan.deltaCents };
  }

  // delta <= 0: apply now. Refund the difference (if any) first so we never leave
  // the order changed but the money un-returned.
  let refundedCents = 0;
  if (plan.deltaCents < 0) {
    const target = -plan.deltaCents;
    const { payments, refundedCents: done } = await refundAcrossPayments(order.payments, target);
    refundedCents = done;
    await recordRefund(order.id, payments, false);
  }

  await applyItemsAndStock(order, plan.newItems);
  await updateOrderTotal(order.id, plan.newTotalCents, plan.newSubtotalCents, plan.newTaxCents);
  return { applied: true, refundedCents };
}

/** Webhook entry point: applies the staged edit whose top-up payment just completed. */
export async function applyEditBySquareOrderId(squareOrderId: string, squarePaymentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("order_edits")
    .select("id, order_id, status, delta_cents, new_items")
    .eq("square_order_id", squareOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const editRow = data as { id: string; order_id: string; status: string; delta_cents: number; new_items: NewItem[] };
  if (editRow.status !== "pending") return false;

  // Claim it so duplicate webhook deliveries can't apply twice.
  const { data: claimed, error: claimErr } = await supabase
    .from("order_edits")
    .update({ status: "applied", square_payment_id: squarePaymentId })
    .eq("id", editRow.id)
    .eq("status", "pending")
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) return false;

  const order = await getFullOrder(editRow.order_id);
  if (!order) return false;

  const newItems = (editRow.new_items ?? []).map((it) => ({
    product_id: it.product_id ?? null,
    variation_id: it.variation_id ?? null,
    product_name: it.product_name,
    variation_label: it.variation_label ?? null,
    unit_price_cents: Number(it.unit_price_cents) || 0,
    quantity: Number(it.quantity) || 0,
    line_total_cents: Number(it.line_total_cents) || 0,
  }));
  const newSubtotalCents = newItems.reduce((s, i) => s + i.line_total_cents, 0);
  const newTaxCents = calculateTaxCents(newSubtotalCents, order.hst_percent);
  const newTotalCents = newSubtotalCents + newTaxCents;

  await applyItemsAndStock(order, newItems);
  await recordPaymentAndTotal(
    order.id,
    { square_payment_id: squarePaymentId, amount_cents: editRow.delta_cents, refunded_cents: 0 },
    newTotalCents,
    newSubtotalCents,
    newTaxCents,
  );
  return true;
}

/**
 * Full refund of an order (within the 48h window): refunds whatever is still
 * unrefunded across its payments, restocks every item, and marks it refunded.
 */
export async function refundOrderFull(order: FullOrder): Promise<{ refundedCents: number }> {
  if (!isOrderRefundable(order)) throw new Error("This order can no longer be refunded.");
  if (!isSquareConfigured()) throw new Error("Refunds are not available right now.");

  const totalPaid = order.payments.reduce((s, p) => s + p.amount_cents, 0);
  const alreadyRefunded = order.payments.reduce((s, p) => s + p.refunded_cents, 0);
  const target = totalPaid - alreadyRefunded;
  if (target <= 0) throw new Error("This order has already been fully refunded.");

  const { payments, refundedCents } = await refundAcrossPayments(order.payments, target);

  // Restock everything that was in the order.
  for (const item of order.items) {
    if (item.product_id != null) await adjustProductStock(item.product_id, item.variation_label, -item.quantity);
  }
  await recordRefund(order.id, payments, true);

  // Notify the shop owner of the refund (best-effort).
  try {
    const record = await getOrderRecordById(order.id);
    if (record) await sendRefundAdminEmail(record, refundedCents);
  } catch {
    // Email is best-effort; the refund itself already succeeded.
  }

  return { refundedCents };
}

/** Convenience re-export so controllers can return the fresh display record. */
export { getOrderRecordById };
