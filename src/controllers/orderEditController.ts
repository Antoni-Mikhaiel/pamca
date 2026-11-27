import { ApiRequest, ApiResponse, getClientIp } from "../lib/http.js";
import {
  isGuestOrderAccessBlocked,
  recordGuestOrderAccessFailure,
  TOO_MANY_ATTEMPTS_MESSAGE,
} from "../services/rateLimitService.js";
import { getAuthUser, readJsonBody } from "../lib/adminAuth.js";
import { normalizePhone } from "../lib/customer.js";
import { FullOrder, getFullOrder, getOrderRecordById, lookupOrder } from "../services/orderService.js";
import { buildEditPlan, commitEdit, refundOrderFull, OrderEditRequest } from "../services/orderEditService.js";
import { getTracking, TrackingInfo } from "../services/canadaPostService.js";

/** Live tracking is cached briefly per PIN to avoid hammering Canada Post on reloads. */
const trackingCache = new Map<string, { at: number; info: TrackingInfo }>();
const TRACKING_TTL_MS = 5 * 60 * 1000;

type OrderAccess =
  | { ok: true; order: FullOrder }
  | { ok: false; status: 403 | 429; message: string };

const NO_ACCESS: OrderAccess = { ok: false, status: 403, message: "You don't have access to this order." };
const TOO_MANY_ATTEMPTS: OrderAccess = { ok: false, status: 429, message: TOO_MANY_ATTEMPTS_MESSAGE };

/**
 * Resolves the order the caller is allowed to act on: a signed-in owner (Bearer
 * token + their own `orderId`), or a guest who supplies the matching Purchase ID +
 * phone. Guest attempts are rate limited (failures only) because this pair also
 * authorizes edits and refunds — without a limit the 6-digit ID could be
 * brute-forced for a known phone number.
 */
async function resolveAccessibleOrder(req: ApiRequest, body: Record<string, unknown>): Promise<OrderAccess> {
  const user = await getAuthUser(req);
  if (user && body.orderId) {
    const order = await getFullOrder(String(body.orderId));
    if (order && order.user_id === user.id) return { ok: true, order };
  }

  const purchaseId = String(body.purchaseId ?? "").trim();
  const phone = normalizePhone(body.phone);
  if (!/^\d{6}$/.test(purchaseId) || !phone) return NO_ACCESS;

  const ip = getClientIp(req);
  if (await isGuestOrderAccessBlocked(ip, phone)) return TOO_MANY_ATTEMPTS;

  const record = await lookupOrder(purchaseId, phone);
  if (!record) {
    await recordGuestOrderAccessFailure(ip, phone);
    return NO_ACCESS;
  }
  const order = await getFullOrder(record.id);
  return order ? { ok: true, order } : NO_ACCESS;
}

/**
 * POST /api/orders/get — returns a single order in display shape for the order
 * detail page. Authorized as the signed-in owner (Bearer + orderId) or a guest
 * (purchaseId + phone), the same rule used for edits/refunds.
 */
export async function handleGetOrder(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const access = await resolveAccessibleOrder(req, body);
  if (!access.ok) {
    res.status(access.status).json({ success: false, message: access.message });
    return;
  }
  const order = access.order;
  const record = await getOrderRecordById(order.id);
  res.status(200).json({ success: true, data: { order: record } });
}

/**
 * POST /api/orders/tracking — live Canada Post tracking for one order. Same
 * owner/guest authorization as the other order endpoints. Returns
 * `{ data: { tracking: null } }` when no tracking number has been set yet, or
 * `{ data: { tracking: { pin, status, expectedDelivery, events, error? } } }`.
 * A failed lookup (e.g. before the first scan) returns the number with an `error`
 * note rather than a 500, so the page can still show the tracking number.
 */
export async function handleOrderTracking(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const access = await resolveAccessibleOrder(req, body);
  if (!access.ok) {
    res.status(access.status).json({ success: false, message: access.message });
    return;
  }
  const order = access.order;

  const record = await getOrderRecordById(order.id);
  const pin = record?.tracking_pin ?? "";
  if (!pin) {
    res.status(200).json({ success: true, data: { tracking: null } });
    return;
  }

  try {
    const cached = trackingCache.get(pin);
    const info =
      cached && Date.now() - cached.at < TRACKING_TTL_MS
        ? cached.info
        : await getTracking(pin);
    if (!cached || Date.now() - cached.at >= TRACKING_TTL_MS) {
      trackingCache.set(pin, { at: Date.now(), info });
    }
    res.status(200).json({
      success: true,
      data: { tracking: { pin: info.pin, status: info.status, expectedDelivery: info.expectedDelivery, events: info.events } },
    });
  } catch (error) {
    res.status(200).json({
      success: true,
      data: { tracking: { pin, status: "", expectedDelivery: null, events: [], error: error instanceof Error ? error.message : "Tracking unavailable" } },
    });
  }
}

/** POST /api/orders/edit/preview — money breakdown + diff for a proposed edit. */
export async function handleEditPreview(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<Record<string, unknown>>(req);
  const access = await resolveAccessibleOrder(req, body);
  if (!access.ok) {
    res.status(access.status).json({ success: false, message: access.message });
    return;
  }
  const order = access.order;

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
  const access = await resolveAccessibleOrder(req, body);
  if (!access.ok) {
    res.status(access.status).json({ success: false, message: access.message });
    return;
  }
  const order = access.order;

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
  const access = await resolveAccessibleOrder(req, body);
  if (!access.ok) {
    res.status(access.status).json({ success: false, message: access.message });
    return;
  }
  const order = access.order;

  try {
    const result = await refundOrderFull(order);
    const updated = await getOrderRecordById(order.id);
    res.status(200).json({ success: true, data: { refundedCents: result.refundedCents, order: updated } });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Could not refund the order." });
  }
}
