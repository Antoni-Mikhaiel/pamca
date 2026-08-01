import { OrderRecord } from "../models/types.js";
import { PICKUP_SERVICE_NAME } from "../lib/customer.js";

// Centralized transactional email via Brevo. `sendBrevoEmail` is the single place
// that talks to Brevo; the contact form and the order/refund notifications all use it.
const brevoApiKey = process.env.BREVO_API_KEY ?? "";
const adminEmail = process.env.CONTACT_TO_EMAIL ?? "sales@pamca.net";
const fromEmail = process.env.CONTACT_FROM_EMAIL ?? "noreply@pamca.net";
const fromName = process.env.CONTACT_FROM_NAME ?? "PAMCA";

// CRA GST/HST registration number. Required by law on the customer's receipt, so
// it is shown on the customer order-confirmation email only.
const HST_REGISTRATION = "HST # 85016 4724 RT0001";

// In-store pickup location shown to the customer when they choose pickup at checkout.
const PICKUP_LOCATION = "1920 Yonge Street, Toronto, ON M4S 3E6";

/** True when the order is an in-store pickup (no address, no shipping charge). */
function isPickupOrder(order: OrderRecord): boolean {
  return order.shipping_service_name === PICKUP_SERVICE_NAME;
}

interface Recipient {
  email: string;
  name?: string;
}

export interface BrevoMessage {
  to: Recipient[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: Recipient;
}

export function isEmailConfigured(): boolean {
  return Boolean(brevoApiKey);
}

/** Sends one email through Brevo's transactional API. Throws if not configured or on a non-2xx. */
export async function sendBrevoEmail(msg: BrevoMessage): Promise<void> {
  if (!brevoApiKey) throw new Error("BREVO_API_KEY is not configured");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": brevoApiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: msg.to,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      subject: msg.subject,
      htmlContent: msg.html,
      ...(msg.text ? { textContent: msg.text } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Brevo email send failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
}

// --------------------------- helpers ---------------------------

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents: number): string {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function customerName(order: OrderRecord): string {
  return `${order.customer_first_name ?? ""} ${order.customer_last_name ?? ""}`.trim() || "Customer";
}

/** Human method name for a shipping-breakdown line. */
function shippingMethodName(method: string): string {
  return method === "third_party" ? "Third-Party Courier" : "Canada Post";
}

/**
 * Shipping row(s) for the receipt footer. When the order has a per-line breakdown it
 * renders a "Shipping" total plus one muted sub-row per line (Canada Post combined +
 * each third-party item); otherwise it falls back to a single shipping row.
 */
function shippingFootRows(order: OrderRecord): string {
  const breakdown = order.shipping_breakdown || [];
  if (breakdown.length) {
    const total = breakdown.reduce((s, l) => s + (Number(l.cents) || 0), 0);
    const header = `<tr><td colspan="3" style="padding:10px 10px 2px;text-align:right;font-weight:700;">Shipping</td>
        <td style="padding:10px 10px 2px;text-align:right;font-weight:700;">${money(total)}</td></tr>`;
    const lines = breakdown
      .map(
        (l) => `<tr><td colspan="3" style="padding:0 10px 2px;text-align:right;color:#888;font-size:12px;">${shippingMethodName(l.method)} — ${escapeHtml(l.label)}</td>
        <td style="padding:0 10px 2px;text-align:right;color:#888;font-size:12px;">${money(l.cents)}</td></tr>`,
      )
      .join("");
    return header + lines;
  }
  return Number(order.shipping_cents) > 0
    ? `<tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;">Shipping${order.shipping_service_name ? ` (${escapeHtml(order.shipping_service_name)})` : ""}</td>
        <td style="padding:10px;text-align:right;font-weight:700;">${money(order.shipping_cents)}</td></tr>`
    : "";
}

/** Items table used in every order email (receipt). */
function itemsTable(order: OrderRecord): string {
  const rows = (order.items || [])
    .map((it) => {
      const variant = it.variation_label ? ` <span style="color:#888;">(${escapeHtml(it.variation_label)})</span>` : "";
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.product_name)}${variant}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${Number(it.quantity) || 0}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${money(it.unit_price_cents)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${money(it.line_total_cents)}</td>
      </tr>`;
    })
    .join("");

  const refundRow =
    Number(order.amount_refunded_cents) > 0
      ? `<tr><td colspan="3" style="padding:8px 10px;text-align:right;color:#b02a37;">Refunded</td>
         <td style="padding:8px 10px;text-align:right;color:#b02a37;font-weight:700;">−${money(order.amount_refunded_cents)}</td></tr>`
      : "";

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 4px;">
      <thead>
        <tr style="background:#f4f7f7;color:#0a615b;">
          <th style="padding:8px 10px;text-align:left;">Item</th>
          <th style="padding:8px 10px;text-align:center;">Qty</th>
          <th style="padding:8px 10px;text-align:right;">Unit</th>
          <th style="padding:8px 10px;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;">Subtotal</td>
        <td style="padding:10px;text-align:right;font-weight:700;">${money(order.subtotal_cents)}</td></tr>
        ${shippingFootRows(order)}
        <tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;">HST (${order.hst_percent}%)</td>
        <td style="padding:10px;text-align:right;font-weight:700;">${money(order.tax_cents)}</td></tr>
        <tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;">Total</td>
        <td style="padding:10px;text-align:right;font-weight:700;font-size:15px;">${money(order.total_cents)}</td></tr>
        ${refundRow}
      </tfoot>
    </table>`;
}

function detailsBlock(order: OrderRecord): string {
  const pickup = isPickupOrder(order);
  const addressLine = pickup
    ? "<strong>In-store pickup</strong> — no shipping"
    : order.customer_street_number && order.customer_street_name
      ? `${escapeHtml(order.customer_street_number)} ${escapeHtml(order.customer_street_name)}, ${escapeHtml(order.customer_city || "")} ${escapeHtml(order.customer_province || "")} ${escapeHtml(order.customer_postal_code || "")}`
      : "—";
  const pharmacyRow = order.customer_pharmacy_name
    ? `<tr><td style="color:#888;padding-right:12px;">Pharmacy</td><td>${escapeHtml(order.customer_pharmacy_name)}</td></tr>`
    : "";
  return `<table style="font-size:14px;color:#333;line-height:1.6;">
      <tr><td style="color:#888;padding-right:12px;">Name</td><td>${escapeHtml(customerName(order))}</td></tr>
      ${pharmacyRow}
      <tr><td style="color:#888;padding-right:12px;">Email</td><td>${escapeHtml(order.customer_email || "—")}</td></tr>
      <tr><td style="color:#888;padding-right:12px;">Phone</td><td>${escapeHtml(order.customer_phone || "—")}</td></tr>
      <tr><td style="color:#888;padding-right:12px;">${pickup ? "Fulfilment" : "Address"}</td><td>${addressLine}</td></tr>
    </table>`;
}

function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222;">
      <div style="background:linear-gradient(135deg,#008080,#20b2aa);color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:20px;">${escapeHtml(title)}</h1>
      </div>
      <div style="border:1px solid #e6e6e6;border-top:none;border-radius:0 0 12px 12px;padding:22px 24px;">
        ${bodyHtml}
      </div>
    </div>`;
}

function pidBadge(order: OrderRecord): string {
  return `<div style="display:inline-block;background:#f4f7f7;border:1px dashed #20b2aa;border-radius:10px;padding:10px 16px;margin:6px 0;">
      <span style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Purchase ID</span><br>
      <span style="font-size:22px;font-weight:700;color:#0a615b;letter-spacing:2px;">${escapeHtml(order.purchase_id || "—")}</span>
    </div>`;
}

// --------------------------- order notifications ---------------------------

/**
 * Sends the two purchase emails: the shop owner (CONTACT_TO_EMAIL) gets the buyer's
 * details + receipt; the customer gets a confirmation with their receipt, the
 * shipping estimate, and — most importantly — their Purchase ID. Best-effort: a
 * missing customer email simply skips that one, and the two sends are independent
 * so one failing never blocks the other.
 */
export async function sendPurchaseEmails(order: OrderRecord): Promise<void> {
  const placed = formatDate(order.created_at);

  // 1) Owner / admin copy
  const adminHtml = shell(
    `New order #${order.purchase_id ?? ""}`,
    `<p style="margin:0 0 14px;">A new order was placed on ${escapeHtml(placed)}.</p>
     ${pidBadge(order)}
     <h3 style="margin:18px 0 6px;color:#0a615b;">Customer</h3>
     ${detailsBlock(order)}
     <h3 style="margin:18px 0 6px;color:#0a615b;">Order</h3>
     ${itemsTable(order)}`,
  );
  // Isolated so a failed owner copy never suppresses the customer's confirmation —
  // the customer email is the one carrying their Purchase ID, so it matters most.
  try {
    await sendBrevoEmail({
      to: [{ email: adminEmail }],
      subject: `New order #${order.purchase_id ?? ""} — ${customerName(order)} — ${money(order.total_cents)}`,
      html: adminHtml,
      ...(order.customer_email ? { replyTo: { email: order.customer_email, name: customerName(order) } } : {}),
    });
  } catch (err) {
    console.error(`[email] owner new-order notification failed for #${order.purchase_id ?? ""}:`, err);
  }

  // 2) Customer confirmation
  if (order.customer_email) {
    // Pickup orders show a store-pickup notice (with the address); shipped orders show
    // no delivery-time banner.
    const deliveryBanner = isPickupOrder(order)
      ? `<div style="margin:18px 0;padding:14px 16px;background:#f4f7f7;border-radius:10px;color:#0a615b;font-weight:600;">
           🏪 Your order will be ready for <strong>in-store pickup</strong> at ${escapeHtml(PICKUP_LOCATION)}. We'll let you know as soon as it's ready.
         </div>`
      : "";
    const customerHtml = shell(
      "Thank you for your order!",
      `<p style="margin:0 0 8px;">Hi ${escapeHtml(order.customer_first_name || "there")}, your payment was received and your order is confirmed.</p>
       ${order.customer_pharmacy_name ? `<p style="margin:0 0 8px;color:#0a615b;font-weight:600;">🏥 ${escapeHtml(order.customer_pharmacy_name)}</p>` : ""}
       <p style="margin:0 0 14px;">Please keep your Purchase ID — you can use it (with your phone number) to view or manage your order anytime.</p>
       ${pidBadge(order)}
       <h3 style="margin:18px 0 6px;color:#0a615b;">Your receipt</h3>
       ${itemsTable(order)}
       <p style="margin:6px 2px 0;text-align:right;color:#888;font-size:12px;">${HST_REGISTRATION}</p>
       <p style="margin:14px 0 0;">Placed: ${escapeHtml(placed)}</p>
       ${deliveryBanner}`,
    );
    try {
      await sendBrevoEmail({
        to: [{ email: order.customer_email, name: customerName(order) }],
        subject: `Your PAMCA order is confirmed — Purchase ID ${order.purchase_id ?? ""}`,
        html: customerHtml,
      });
    } catch (err) {
      console.error(`[email] customer order confirmation failed for #${order.purchase_id ?? ""}:`, err);
    }
  }
}

/**
 * Sends the two "order updated" emails after an edit is applied: the owner gets the
 * buyer's details + the full revised order; the customer gets a confirmation with their
 * revised receipt. Both reflect what the order looks like *now*. Best-effort and
 * independent — one failing send never blocks the other.
 */
export async function sendOrderEditedEmails(order: OrderRecord): Promise<void> {
  const placed = formatDate(order.created_at);

  // 1) Owner / admin copy — the full order as it stands after the edit.
  const adminHtml = shell(
    `Order updated #${order.purchase_id ?? ""}`,
    `<p style="margin:0 0 14px;">This order was <strong>updated</strong>. Here's what it looks like now.</p>
     ${pidBadge(order)}
     <h3 style="margin:18px 0 6px;color:#0a615b;">Customer</h3>
     ${detailsBlock(order)}
     <h3 style="margin:18px 0 6px;color:#0a615b;">Updated order</h3>
     ${itemsTable(order)}`,
  );
  try {
    await sendBrevoEmail({
      to: [{ email: adminEmail }],
      subject: `Order updated #${order.purchase_id ?? ""} — ${customerName(order)} — ${money(order.total_cents)}`,
      html: adminHtml,
      ...(order.customer_email ? { replyTo: { email: order.customer_email, name: customerName(order) } } : {}),
    });
  } catch (err) {
    console.error(`[email] owner order-updated notification failed for #${order.purchase_id ?? ""}:`, err);
  }

  // 2) Customer confirmation — their revised receipt.
  if (order.customer_email) {
    const customerHtml = shell(
      "Your order has been updated",
      `<p style="margin:0 0 8px;">Hi ${escapeHtml(order.customer_first_name || "there")}, your order has been updated. Here's your revised receipt.</p>
       ${order.customer_pharmacy_name ? `<p style="margin:0 0 8px;color:#0a615b;font-weight:600;">🏥 ${escapeHtml(order.customer_pharmacy_name)}</p>` : ""}
       <p style="margin:0 0 14px;">Keep your Purchase ID — you can use it (with your phone number) to view or manage your order anytime.</p>
       ${pidBadge(order)}
       <h3 style="margin:18px 0 6px;color:#0a615b;">Your updated receipt</h3>
       ${itemsTable(order)}
       <p style="margin:6px 2px 0;text-align:right;color:#888;font-size:12px;">${HST_REGISTRATION}</p>
       <p style="margin:14px 0 0;">Placed: ${escapeHtml(placed)}</p>`,
    );
    try {
      await sendBrevoEmail({
        to: [{ email: order.customer_email, name: customerName(order) }],
        subject: `Your PAMCA order was updated — Purchase ID ${order.purchase_id ?? ""}`,
        html: customerHtml,
      });
    } catch (err) {
      console.error(`[email] customer order-updated confirmation failed for #${order.purchase_id ?? ""}:`, err);
    }
  }
}

/**
 * Notifies the shop owner that an order was refunded. Mirrors the order-made email
 * (purchase date, full customer details, items) and adds the refund date + value.
 */
export async function sendRefundAdminEmail(order: OrderRecord, refundedCents: number): Promise<void> {
  const refundDate = formatDate(new Date().toISOString());
  const purchaseDate = formatDate(order.created_at);
  const html = shell(
    `Order refunded #${order.purchase_id ?? ""}`,
    `<p style="margin:0 0 14px;">This order has been <strong style="color:#b02a37;">refunded</strong>.</p>
     <div style="display:inline-block;background:#fbeaea;border:1px solid #f0c4c4;border-radius:10px;padding:10px 16px;margin:6px 0;">
       <span style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Refund value</span><br>
       <span style="font-size:22px;font-weight:700;color:#b02a37;">${money(refundedCents)}</span>
     </div>
     ${pidBadge(order)}
     <table style="font-size:14px;color:#333;line-height:1.6;margin:8px 0;">
       <tr><td style="color:#888;padding-right:12px;">Refund date</td><td>${escapeHtml(refundDate)}</td></tr>
       <tr><td style="color:#888;padding-right:12px;">Purchase date</td><td>${escapeHtml(purchaseDate)}</td></tr>
     </table>
     <h3 style="margin:18px 0 6px;color:#0a615b;">Customer</h3>
     ${detailsBlock(order)}
     <h3 style="margin:18px 0 6px;color:#0a615b;">Items in the order</h3>
     ${itemsTable(order)}`,
  );
  await sendBrevoEmail({
    to: [{ email: adminEmail }],
    subject: `REFUNDED — Order #${order.purchase_id ?? ""} — ${customerName(order)} — ${money(refundedCents)}`,
    html,
    ...(order.customer_email ? { replyTo: { email: order.customer_email, name: customerName(order) } } : {}),
  });
}
