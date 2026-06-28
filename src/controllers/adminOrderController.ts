import { ApiRequest, ApiResponse } from "../lib/http.js";
import { requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import {
  listAllOrders,
  getFullOrder,
  setOrderUneditable,
  setOrderCompleted,
  setOrderTracking,
  orderAgeMs,
  EDIT_WINDOW_MS,
} from "../services/orderService.js";
import { getDashboardStats } from "../services/dashboardService.js";

/** GET /api/admin/dashboard — aggregated store statistics (admin only). */
export async function handleAdminDashboard(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const stats = await getDashboardStats();
  res.status(200).json({ success: true, data: stats });
}

/**
 * GET /api/admin/orders — orders with their items (admin only). Pending orders
 * (checkout started but payment never completed) are omitted; only real,
 * paid/refunded/failed/canceled orders are shown.
 */
export async function handleAdminListOrders(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const orders = (await listAllOrders()).filter((o) => o.status !== "pending");
  res.status(200).json({ success: true, data: { orders } });
}

/**
 * POST /api/admin/orders/flag — set/clear an order's "uneditable" early-lock. Only
 * permitted within the first 24h of the order (after that, editing is locked anyway).
 */
export async function handleAdminFlagOrder(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  const body = readJsonBody<{ orderId?: unknown; uneditable?: unknown }>(req);
  const orderId = String(body.orderId ?? "");
  const uneditable = body.uneditable === true || body.uneditable === "true";
  if (!orderId) {
    res.status(400).json({ success: false, message: "Missing order id." });
    return;
  }

  const order = await getFullOrder(orderId);
  if (!order) {
    res.status(404).json({ success: false, message: "Order not found." });
    return;
  }
  if (orderAgeMs(order.created_at) >= EDIT_WINDOW_MS) {
    res.status(400).json({ success: false, message: "The 24-hour window to lock this order has passed." });
    return;
  }

  const updated = await setOrderUneditable(orderId, uneditable);
  res.status(200).json({ success: true, data: { order: updated } });
}

/**
 * POST /api/admin/orders/complete — mark/unmark an order as completed (fulfilled).
 * Surfaced to the customer as a "Completed" status; does not affect editability.
 */
export async function handleAdminCompleteOrder(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  const body = readJsonBody<{ orderId?: unknown; completed?: unknown }>(req);
  const orderId = String(body.orderId ?? "");
  const completed = body.completed === true || body.completed === "true";
  if (!orderId) {
    res.status(400).json({ success: false, message: "Missing order id." });
    return;
  }

  const order = await getFullOrder(orderId);
  if (!order) {
    res.status(404).json({ success: false, message: "Order not found." });
    return;
  }

  const updated = await setOrderCompleted(orderId, completed);
  res.status(200).json({ success: true, data: { order: updated } });
}

/**
 * POST /api/admin/orders/tracking — record (or clear) an order's Canada Post
 * tracking number. Stamps `shipped_at` the first time one is set; powers live
 * tracking on the customer's order/profile pages.
 */
export async function handleAdminSetTracking(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  const body = readJsonBody<{ orderId?: unknown; trackingPin?: unknown }>(req);
  const orderId = String(body.orderId ?? "");
  const trackingPin = String(body.trackingPin ?? "").trim();
  if (!orderId) {
    res.status(400).json({ success: false, message: "Missing order id." });
    return;
  }

  const order = await getFullOrder(orderId);
  if (!order) {
    res.status(404).json({ success: false, message: "Order not found." });
    return;
  }

  const updated = await setOrderTracking(orderId, trackingPin);
  res.status(200).json({ success: true, data: { order: updated } });
}
