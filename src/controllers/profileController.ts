import { ApiRequest, ApiResponse } from "../lib/http.js";
import { getAuthUser, readJsonBody } from "../lib/adminAuth.js";
import { validateCustomerDetails, normalizePhone } from "../lib/customer.js";
import { getProfile, updateProfile } from "../services/profileService.js";
import { listOrdersForUser, lookupOrder } from "../services/orderService.js";

/** GET /api/profile — the signed-in shopper's saved details plus their order history. */
export async function handleGetProfile(req: ApiRequest, res: ApiResponse): Promise<void> {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: "Sign in to view your profile." });
    return;
  }

  const [profile, orders] = await Promise.all([getProfile(user.id, user.email), listOrdersForUser(user.id)]);
  res.status(200).json({ success: true, data: { profile, orders } });
}

/** PUT /api/profile — update the editable contact/delivery fields (not the login email). */
export async function handleUpdateProfile(req: ApiRequest, res: ApiResponse): Promise<void> {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: "Sign in to update your profile." });
    return;
  }

  const validation = validateCustomerDetails(readJsonBody<Record<string, unknown>>(req));
  if (!validation.ok) {
    res.status(400).json({ success: false, message: validation.error });
    return;
  }

  await updateProfile(user.id, user.email, validation.value);
  const profile = await getProfile(user.id, user.email);
  res.status(200).json({ success: true, data: { profile } });
}

/**
 * POST /api/orders/lookup — guest order lookup. Requires both the 6-digit purchase
 * id and the order's phone number, so the id alone can't reveal someone's details.
 */
export async function handleLookupOrder(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<{ purchaseId?: unknown; phone?: unknown }>(req);
  const purchaseId = String(body.purchaseId ?? "").trim();
  const phone = normalizePhone(body.phone);

  if (!/^\d{6}$/.test(purchaseId) || !phone) {
    res.status(400).json({ success: false, message: "Enter your 6-digit Purchase ID and the phone number on the order." });
    return;
  }

  const order = await lookupOrder(purchaseId, phone);
  if (!order) {
    res.status(404).json({ success: false, message: "No order matches that Purchase ID and phone number." });
    return;
  }

  res.status(200).json({ success: true, data: { order } });
}
