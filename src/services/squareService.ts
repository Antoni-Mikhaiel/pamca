import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

// Square credentials live in env (never in client code). Until they are filled
// in, `isSquareConfigured()` is false and the checkout endpoint degrades to a
// friendly "not available yet" message instead of erroring.
const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? "";
const locationId = process.env.SQUARE_LOCATION_ID ?? "";
const environment = (process.env.SQUARE_ENVIRONMENT ?? "sandbox").toLowerCase();
const apiVersion = process.env.SQUARE_API_VERSION ?? "2025-04-16";
const currency = (process.env.SQUARE_CURRENCY ?? "CAD").toUpperCase();

const baseUrl =
  environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";

export function isSquareConfigured(): boolean {
  return Boolean(accessToken && locationId);
}

export function getSquareCurrency(): string {
  return currency;
}

export interface SquareLineItem {
  name: string;
  quantity: number;
  /** Unit price in integer minor units (e.g. cents). */
  amountCents: number;
  note?: string | null;
}

export interface PaymentLinkResult {
  url: string;
  paymentLinkId: string;
  orderId: string | null;
}

/**
 * Creates a Square hosted Payment Link for the given line items and returns the
 * URL to redirect the shopper to. `referenceId` is our order id (Square echoes
 * it back and it is searchable in the dashboard); `redirectUrl` is where Square
 * returns the shopper after a successful payment.
 */
export interface SquareBuyer {
  email?: string;
  /** E.164, e.g. +16135551234. */
  phone?: string;
  firstName?: string;
  lastName?: string;
  addressLine1?: string;
}

export async function createPaymentLink(params: {
  lineItems: SquareLineItem[];
  redirectUrl?: string;
  referenceId?: string;
  note?: string;
  buyer?: SquareBuyer;
}): Promise<PaymentLinkResult> {
  if (!isSquareConfigured()) throw new Error("Square is not configured");

  const order = {
    location_id: locationId,
    ...(params.referenceId ? { reference_id: params.referenceId.slice(0, 40) } : {}),
    line_items: params.lineItems.map((item) => ({
      name: item.name.slice(0, 500),
      quantity: String(Math.max(1, Math.round(item.quantity))),
      base_price_money: { amount: Math.max(0, Math.round(item.amountCents)), currency },
      ...(item.note ? { note: item.note.slice(0, 500) } : {}),
    })),
  };

  // Pre-fill the buyer's contact/shipping details on Square's hosted page so the
  // shopper doesn't retype what they entered in our checkout pop-up.
  const buyer = params.buyer;
  const prePopulatedData = buyer
    ? {
        ...(buyer.email ? { buyer_email: buyer.email } : {}),
        ...(buyer.phone ? { buyer_phone_number: buyer.phone } : {}),
        ...(buyer.addressLine1 || buyer.firstName || buyer.lastName
          ? {
              buyer_address: {
                ...(buyer.addressLine1 ? { address_line_1: buyer.addressLine1.slice(0, 500) } : {}),
                ...(buyer.firstName ? { first_name: buyer.firstName.slice(0, 300) } : {}),
                ...(buyer.lastName ? { last_name: buyer.lastName.slice(0, 300) } : {}),
                country: "CA",
              },
            }
          : {}),
      }
    : null;

  const body = {
    idempotency_key: randomUUID(),
    order,
    ...(params.redirectUrl ? { checkout_options: { redirect_url: params.redirectUrl } } : {}),
    ...(prePopulatedData && Object.keys(prePopulatedData).length ? { pre_populated_data: prePopulatedData } : {}),
    ...(params.note ? { payment_note: params.note } : {}),
  };

  const response = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": apiVersion,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as {
    payment_link?: { id?: string; url?: string; order_id?: string };
    errors?: Array<{ detail?: string }>;
  };

  if (!response.ok) {
    throw new Error(json.errors?.[0]?.detail || `Square request failed (${response.status})`);
  }

  const link = json.payment_link ?? {};
  if (!link.url) throw new Error("Square did not return a checkout URL");

  return {
    url: link.url,
    paymentLinkId: String(link.id ?? ""),
    orderId: link.order_id ? String(link.order_id) : null,
  };
}

export interface RefundResult {
  refundId: string;
  status: string;
}

/**
 * Refunds part or all of a captured Square payment. `amountCents` must not exceed
 * the payment's remaining refundable amount (Square rejects over-refunds). Used for
 * both edit-driven partial refunds and full order refunds.
 */
export async function refundPayment(params: {
  paymentId: string;
  amountCents: number;
  reason?: string;
}): Promise<RefundResult> {
  if (!isSquareConfigured()) throw new Error("Square is not configured");
  if (!params.paymentId) throw new Error("Missing payment id to refund");
  if (!Number.isFinite(params.amountCents) || params.amountCents <= 0) {
    throw new Error("Refund amount must be positive");
  }

  const body = {
    idempotency_key: randomUUID(),
    payment_id: params.paymentId,
    amount_money: { amount: Math.round(params.amountCents), currency },
    ...(params.reason ? { reason: params.reason.slice(0, 192) } : {}),
  };

  const response = await fetch(`${baseUrl}/v2/refunds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": apiVersion,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as {
    refund?: { id?: string; status?: string };
    errors?: Array<{ detail?: string }>;
  };

  if (!response.ok) {
    throw new Error(json.errors?.[0]?.detail || `Square refund failed (${response.status})`);
  }

  const refund = json.refund ?? {};
  return { refundId: String(refund.id ?? ""), status: String(refund.status ?? "PENDING") };
}

/**
 * Verifies a Square webhook signature. Square signs HMAC-SHA256 over
 * (notificationUrl + rawRequestBody) with the endpoint's signature key, base64
 * encoded. When no signature key is configured yet, verification is skipped so
 * the endpoint can be wired up before secrets are in place.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, notificationUrl: string): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "";
  if (!key) return true;
  if (!signature) return false;

  const expected = createHmac("sha256", key)
    .update(notificationUrl + rawBody)
    .digest("base64");

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
