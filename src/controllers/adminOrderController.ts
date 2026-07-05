import { ApiRequest, ApiResponse } from "../lib/http.js";
import { requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import {
  listAllOrders,
  getFullOrder,
  getOrderRecordById,
  setOrderUneditable,
  setOrderCompleted,
  setOrderTracking,
  orderAgeMs,
  EDIT_WINDOW_MS,
} from "../services/orderService.js";
import { getDashboardStats } from "../services/dashboardService.js";
import { getProductShippingInfo } from "../services/productService.js";
import {
  createNonContractShipment,
  fetchLabelPdfBase64,
  getDefaultItemWeightGrams,
} from "../services/canadaPostService.js";

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

/**
 * POST /api/admin/orders/label — creates a Canada Post (Non-Contract) shipping label
 * for the order's Canada Post items using the service the customer paid for, saves the
 * returned tracking number to the order, and returns the label PDF (base64) to print.
 * Guarded against re-creation (which would charge the account again).
 */
export async function handleAdminCreateLabel(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  const body = readJsonBody<{ orderId?: unknown }>(req);
  const orderId = String(body.orderId ?? "");
  if (!orderId) {
    res.status(400).json({ success: false, message: "Missing order id." });
    return;
  }

  const order = await getOrderRecordById(orderId);
  if (!order) {
    res.status(404).json({ success: false, message: "Order not found." });
    return;
  }
  // Prevent double-charging: a label was already created if a PIN exists.
  if (order.tracking_pin) {
    res.status(400).json({ success: false, message: "This order already has a tracking number. Creating another label would charge again." });
    return;
  }
  const serviceCode = order.shipping_service_code || "";
  if (!/^DOM\./i.test(serviceCode)) {
    res.status(400).json({ success: false, message: "This order has no Canada Post service to label (pickup or third-party only)." });
    return;
  }
  if (!order.customer_postal_code || !order.customer_street_number || !order.customer_street_name) {
    res.status(400).json({ success: false, message: "This order has no shipping address." });
    return;
  }

  // Parcel weight = combined weight of the order's Canada Post items (per-unit weight
  // or the default), matching how the rate was quoted at checkout.
  const productIds = order.items.map((i) => i.product_id).filter((v): v is number => typeof v === "number");
  const info = await getProductShippingInfo(productIds);
  const fallbackG = getDefaultItemWeightGrams();
  let grams = 0;
  for (const it of order.items) {
    const pi = it.product_id != null ? info.get(it.product_id) : undefined;
    // Include an item when it ships by Canada Post (or its product is unknown).
    if (!pi || pi.method === "canada_post") grams += (pi?.weightGrams || fallbackG) * (Number(it.quantity) || 0);
  }

  const name = `${order.customer_first_name ?? ""} ${order.customer_last_name ?? ""}`.trim() || "Customer";
  try {
    const shipment = await createNonContractShipment({
      serviceCode,
      weightKg: grams / 1000,
      reference: order.purchase_id ?? undefined,
      destination: {
        name,
        addressLine1: `${order.customer_street_number} ${order.customer_street_name}`.trim(),
        city: order.customer_city ?? "",
        province: order.customer_province ?? "",
        postalCode: order.customer_postal_code,
        phone: order.customer_phone ?? undefined,
      },
    });

    // Save the tracking number (also stamps shipped_at) before returning.
    const savedOrder = await setOrderTracking(orderId, shipment.trackingPin);

    // Fetch the printable label (best-effort — tracking is already saved either way).
    let labelBase64 = "";
    try {
      labelBase64 = await fetchLabelPdfBase64(shipment.labelHref);
    } catch (err) {
      console.error(`[label] could not fetch PDF for order ${orderId}:`, err);
    }

    res.status(200).json({
      success: true,
      data: { trackingPin: shipment.trackingPin, labelBase64, order: savedOrder },
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : "Could not create the Canada Post label.",
    });
  }
}
