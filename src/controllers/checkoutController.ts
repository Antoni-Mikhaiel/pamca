import { ApiRequest, ApiResponse, parseCookies, getHeader } from "../lib/http.js";
import { readJsonBody, getAuthUser } from "../lib/adminAuth.js";
import { validateCustomerDetails } from "../lib/customer.js";
import { getCartItems, clearCart } from "../services/cartService.js";
import {
  createPendingOrder,
  attachSquareDetails,
  markOrderPaidBySquareOrderId,
  applyStockForOrder,
  getOrderRecordById,
} from "../services/orderService.js";
import { applyEditBySquareOrderId } from "../services/orderEditService.js";
import { sendPurchaseEmails } from "../services/emailService.js";
import { updateProfile } from "../services/profileService.js";
import {
  createPaymentLink,
  isSquareConfigured,
  getSquareCurrency,
  verifyWebhookSignature,
  SquareLineItem,
} from "../services/squareService.js";
import { getProductWeightsGrams } from "../services/productService.js";
import { getShippingRates, getDefaultItemWeightGrams } from "../services/canadaPostService.js";
import { CartItem } from "../models/types.js";

const SITE_URL = (process.env.SITE_URL ?? "").replace(/\/$/, "");

/** Canadian postal code, with or without the middle space (e.g. "M4S 3E6"). */
const POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

/** Total parcel weight (kg) for a cart: per-product weight (or the default) × qty. */
async function computeCartWeightKg(items: CartItem[]): Promise<number> {
  const weights = await getProductWeightsGrams(items.map((i) => i.product_id));
  const fallbackG = getDefaultItemWeightGrams();
  let grams = 0;
  for (const item of items) {
    const perUnit = weights.get(item.product_id) || fallbackG;
    grams += perUnit * (Number(item.quantity) || 0);
  }
  return grams / 1000;
}

/**
 * Quotes Canada Post shipping options for the current cart + a destination postal
 * code. Called from the checkout pop-up before payment so the shopper can pick a
 * delivery method. Returns `{ data: { rates: [{ serviceCode, serviceName,
 * priceCents, transitDays }] } }` (cheapest first).
 */
export async function handleGetShippingRates(req: ApiRequest, res: ApiResponse): Promise<void> {
  const cartToken = parseCookies(req).cart_token;
  if (!cartToken) {
    res.status(400).json({ success: false, message: "Your cart is empty." });
    return;
  }

  const body = readJsonBody<{ postalCode?: string }>(req);
  const postalCode = String(body.postalCode ?? "").trim();
  if (!POSTAL_RE.test(postalCode)) {
    res.status(400).json({ success: false, message: "Enter a valid Canadian postal code." });
    return;
  }

  const items = await getCartItems(cartToken);
  if (items.length === 0) {
    res.status(400).json({ success: false, message: "Your cart is empty." });
    return;
  }

  const weightKg = await computeCartWeightKg(items);
  const rates = await getShippingRates({ destinationPostalCode: postalCode, weightKg });
  res.status(200).json({
    success: true,
    data: {
      rates: rates.map((r) => ({
        serviceCode: r.serviceCode,
        serviceName: r.serviceName,
        priceCents: r.priceCents,
        transitDays: r.transitDays,
      })),
    },
  });
}

/**
 * Snapshots the cart into a pending order (with the shopper's delivery details and
 * a 6-digit purchase id), creates a Square Payment Link, and returns its URL for
 * the client to redirect to. There is no on-site payment form — Square hosts it.
 * The shopper need not be logged in; when they are, the order is linked to them and
 * (if they opted in) their saved profile is updated.
 */
export async function handleCreateCheckout(req: ApiRequest, res: ApiResponse): Promise<void> {
  const cartToken = parseCookies(req).cart_token;
  if (!cartToken) {
    res.status(400).json({ success: false, message: "Your cart is empty." });
    return;
  }

  const body = readJsonBody<Record<string, unknown>>(req);
  const validation = validateCustomerDetails(body);
  if (!validation.ok) {
    res.status(400).json({ success: false, message: validation.error });
    return;
  }
  const customer = validation.value;

  const items = await getCartItems(cartToken);
  if (items.length === 0) {
    res.status(400).json({ success: false, message: "Your cart is empty." });
    return;
  }

  if (!isSquareConfigured()) {
    res.status(503).json({
      success: false,
      message: "Online payment is not available yet. Please contact us to place your order.",
    });
    return;
  }

  // Optional: a signed-in shopper links the order to their account and may save
  // these details as their new defaults.
  const authUser = await getAuthUser(req);
  if (authUser && body.saveProfile === true) {
    try {
      await updateProfile(authUser.id, authUser.email, customer);
    } catch {
      // Saving the profile is best-effort; never block the purchase on it.
    }
  }

  // Re-quote shipping server-side for the chosen service so the price can never be
  // tampered with by the client. If the selected code is no longer offered, fall back
  // to the cheapest available option rather than blocking the purchase.
  const requestedServiceCode = String((body.shippingServiceCode as string) ?? "");
  const weightKg = await computeCartWeightKg(items);
  const rates = await getShippingRates({ destinationPostalCode: customer.postalCode, weightKg });
  const chosenRate = rates.find((r) => r.serviceCode === requestedServiceCode) ?? rates[0] ?? null;
  const shippingCents = chosenRate ? chosenRate.priceCents : 0;

  const currency = getSquareCurrency();
  const order = await createPendingOrder({
    cartToken,
    items,
    currency,
    customer,
    userId: authUser?.id ?? null,
    shippingCents,
    shippingServiceCode: chosenRate?.serviceCode ?? null,
    shippingServiceName: chosenRate?.serviceName ?? null,
  });

  const lineItems: SquareLineItem[] = items.map((item) => ({
    name: item.product_name,
    quantity: item.quantity,
    amountCents: Math.round(Number(item.unit_price) * 100),
    note: item.variation_label,
  }));

  // Shipping as its own line (when charged) so Square collects subtotal + shipping + tax.
  if (order.shippingCents > 0) {
    lineItems.push({
      name: chosenRate?.serviceName ? `Shipping (${chosenRate.serviceName})` : "Shipping",
      quantity: 1,
      amountCents: order.shippingCents,
    });
  }

  // Charge the HST as its own line so the amount Square collects equals the order's
  // stored total_cents (subtotal + tax). Without this the customer would only pay
  // the pre-tax subtotal while the order — and the payments ledger used for refunds
  // — recorded the tax-inclusive total.
  if (order.taxCents > 0) {
    lineItems.push({ name: `HST (${order.hstPercent}%)`, quantity: 1, amountCents: order.taxCents });
  }

  const redirectUrl = SITE_URL ? `${SITE_URL}/?order=success&pid=${order.purchaseId}` : undefined;

  // Construct the full address line for Square from separate fields
  const addressLine = customer.streetNumber && customer.streetName
    ? `${customer.streetNumber} ${customer.streetName}, ${customer.city} ${customer.province} ${customer.postalCode}`
    : undefined;

  try {
    const link = await createPaymentLink({
      lineItems,
      redirectUrl,
      referenceId: order.id,
      note: "PAMCA online order",
      buyer: {
        email: customer.email,
        phone: customer.phone,
        firstName: customer.firstName,
        lastName: customer.lastName,
        addressLine1: addressLine,
      },
    });

    await attachSquareDetails(order.id, {
      paymentLinkId: link.paymentLinkId,
      squareOrderId: link.orderId,
      checkoutUrl: link.url,
    });

    res.status(200).json({ success: true, data: { url: link.url, purchaseId: order.purchaseId } });
  } catch (error) {
    res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : "Could not start checkout",
    });
  }
}

/**
 * Receives Square webhook events. On a completed payment we mark the matching
 * order 'paid', decrement product stock (once), and clear its cart. Always replies
 * 200 once the signature checks out so Square stops retrying. Signature is verified
 * over the raw request body.
 */
export async function handleWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  const signature = getHeader(req, "x-square-hmacsha256-signature");
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL ?? (SITE_URL ? `${SITE_URL}/api/checkout/webhook` : "");

  if (!verifyWebhookSignature(rawBody, signature, notificationUrl)) {
    res.status(401).json({ success: false, message: "Invalid signature" });
    return;
  }

  let event: {
    type?: string;
    data?: { object?: { payment?: { id?: string; order_id?: string; status?: string } } };
  } | null = null;
  try {
    event = JSON.parse(rawBody);
  } catch {
    event = null;
  }

  const type = event?.type ?? "";
  if (type === "payment.created" || type === "payment.updated") {
    const payment = event?.data?.object?.payment;
    if (payment?.order_id && payment.status === "COMPLETED") {
      const result = await markOrderPaidBySquareOrderId(String(payment.order_id), String(payment.id ?? ""));
      if (result) {
        try {
          await applyStockForOrder(result.orderId);
        } catch {
          // Stock application is guarded against double-apply; a failure here
          // shouldn't make us 500 and trigger endless Square retries.
        }
        // Confirmation emails (owner + customer). markOrderPaid... only returns a
        // result on the first paid transition, so these send exactly once.
        try {
          const record = await getOrderRecordById(result.orderId);
          if (record) await sendPurchaseEmails(record);
        } catch {
          // Email is best-effort; never fail the webhook over it.
        }
        if (result.cartToken) {
          try {
            await clearCart(result.cartToken);
          } catch {
            // Cart clearing is best-effort; the payment is already recorded.
          }
        }
      } else {
        // Not an original purchase — it may be the top-up payment for a staged
        // order edit. Applying is idempotent (the edit row is claimed once).
        try {
          await applyEditBySquareOrderId(String(payment.order_id), String(payment.id ?? ""));
        } catch {
          // Best-effort; don't 500 and trigger endless Square retries.
        }
      }
    }
  }

  res.status(200).json({ success: true });
}
