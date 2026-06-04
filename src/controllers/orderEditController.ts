import { ApiRequest, ApiResponse } from "../lib/http.js";
import { getAuthUser, readJsonBody } from "../lib/adminAuth.js";
import { normalizePhone } from "../lib/customer.js";
import { FullOrder, getFullOrder, getOrderRecordById, lookupOrder } from "../services/orderService.js";
import { buildEditPlan, commitEdit, refundOrderFull, OrderEditRequest } from "../services/orderEditService.js";

/**
 * Resolves the order the caller is allowed to act on: a signed-in owner (Bearer
 * token + their own `orderId`), or a guest who supplies the matching Purchase ID +
 * phone. Returns null when neither path authorizes access.
 */
async function resolveAccessibleOrder(req: ApiRequest, body: Record<string, unknown>): Promise<FullOrder | null> {
  const user = await getAuthUser(req);
  if (user && body.orderId) {
    const order = await getFullOrder(String(body.orderId));
    if (order && order.user_id === user.id) return order;
  }

  const purchaseId = String(body.purchaseId ?? "").trim();
  const phone = normalizePhone(body.phone);
  if (/^\d{6}$/.test(purchaseId) && phone) {
    const record = await lookupOrder(purchaseId, phone);
    if (record) return getFullOrder(record.id);
  }
  return null;
}

/**
 * POST /api/orders/get — returns a single order in display shape for the order
 * detail page. Authorized as the signed-in owner (Bearer + orderId) or a guest
 * (purchaseId + phone), the same rule used for edits/refunds.
 */
export async function handleGetOrder(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const order = await resolveAccessibleOrder(req, body);
  if (!order) {
    res.status(403).json({ success: false, message: "You don't have access to this order." });
    return;
  }
  const record = await getOrderRecordById(order.id);
  res.status(200).json({ success: true, data: { order: record } });
}

/** POST /api/orders/edit/preview — money breakdown + diff for a proposed edit. */
export async function handleEditPreview(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const order = await resolveAccessibleOrder(req, body);
  if (!order) {
    res.status(403).json({ success: false, message: "You don't have access to this order." });
    return;
  }

  try {
    const plan = await buildEditPlan(order, body as OrderEditRequest);
    res.status(200).json({
      success: true,
      data: {
        currentTotalCents: order.total_cents,
        newTotalCents: plan.newTotalCents,
        chargeCents: plan.chargeCents,
        refundCents: plan.refundCents,
        deltaCents: plan.deltaCents,
        diff: plan.diff,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Could not preview the edit." });
  }
}

/** POST /api/orders/edit/commit — applies the edit (or returns a Square URL for the top-up). */
export async function handleEditCommit(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const order = await resolveAccessibleOrder(req, body);
  if (!order) {
    res.status(403).json({ success: false, message: "You don't have access to this order." });
    return;
  }

  try {
    const result = await commitEdit(order, body as OrderEditRequest);
    if (result.redirectUrl) {
      res.status(200).json({ success: true, data: { url: result.redirectUrl, chargeCents: result.chargeCents } });
      return;
    }
    const updated = await getOrderRecordById(order.id);
    res.status(200).json({
      success: true,
      data: { applied: true, refundedCents: result.refundedCents ?? 0, order: updated },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Could not apply the edit." });
  }
}

/** POST /api/orders/refund — full refund within the 48h window. */
export async function handleRefundOrder(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const order = await resolveAccessibleOrder(req, body);
  if (!order) {
    res.status(403).json({ success: false, message: "You don't have access to this order." });
    return;
  }

  try {
    const result = await refundOrderFull(order);
    const updated = await getOrderRecordById(order.id);
    res.status(200).json({ success: true, data: { refundedCents: result.refundedCents, order: updated } });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Could not refund the order." });
  }
}
