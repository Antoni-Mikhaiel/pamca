import { ApiRequest, ApiResponse, parseCookies, getHeader } from "../lib/http";
import { getCartItems, clearCart } from "../services/cartService";
import { createPendingOrder, attachSquareDetails, markOrderPaidBySquareOrderId } from "../services/orderService";
import {
  createPaymentLink,
  isSquareConfigured,
  getSquareCurrency,
  verifyWebhookSignature,
  SquareLineItem,
} from "../services/squareService";

const SITE_URL = (process.env.SITE_URL ?? "").replace(/\/$/, "");

/**
 * Snapshots the cart into a pending order, creates a Square Payment Link, and
 * returns its URL for the client to redirect to. There is no on-site checkout
 * page — Square hosts the payment form.
 */
export async function handleCreateCheckout(req: ApiRequest, res: ApiResponse): Promise<void> {
  const cartToken = parseCookies(req).cart_token;
  if (!cartToken) {
    res.status(400).json({ success: false, message: "Your cart is empty." });
    return;
  }

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

  const currency = getSquareCurrency();
  const order = await createPendingOrder({ cartToken, items, currency });

  const lineItems: SquareLineItem[] = items.map((item) => ({
    name: item.product_name,
    quantity: item.quantity,
    amountCents: Math.round(Number(item.unit_price) * 100),
    note: item.variation_label,
  }));

  const redirectUrl = SITE_URL ? `${SITE_URL}/?order=success` : undefined;

  try {
    const link = await createPaymentLink({
      lineItems,
      redirectUrl,
      referenceId: order.id,
      note: "PAMCA online order",
    });

    await attachSquareDetails(order.id, {
      paymentLinkId: link.paymentLinkId,
      squareOrderId: link.orderId,
      checkoutUrl: link.url,
    });

    res.status(200).json({ success: true, data: { url: link.url } });
  } catch (error) {
    res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : "Could not start checkout",
    });
  }
}

/**
 * Receives Square webhook events. On a completed payment we mark the matching
 * order 'paid' and clear its cart. Always replies 200 once the signature checks
 * out so Square stops retrying. Signature is verified over the raw request body.
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
      const cartToken = await markOrderPaidBySquareOrderId(String(payment.order_id), String(payment.id ?? ""));
      if (cartToken) {
        try {
          await clearCart(cartToken);
        } catch {
          // Cart clearing is best-effort; the payment is already recorded.
        }
      }
    }
  }

  res.status(200).json({ success: true });
}
