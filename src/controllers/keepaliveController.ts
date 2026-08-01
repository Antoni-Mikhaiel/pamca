import { ApiRequest, ApiResponse, getHeader } from "../lib/http.js";
import { sendBrevoEmail, isEmailConfigured } from "../services/emailService.js";

/**
 * Monthly Brevo keep-alive. Brevo deactivates credentials/accounts that go
 * unused for an extended period, and this project sends only on real customer
 * activity — so a quiet month can let the account lapse. A scheduled ping keeps
 * the account warm and doubles as a canary: if the send fails, email was already
 * broken and this surfaces it before a customer order does.
 *
 * Triggered by the Vercel cron entry in `vercel.json`. Vercel attaches
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set; without that
 * guard the route would be an open send-mail endpoint for anyone who found it.
 */
const cronSecret = process.env.CRON_SECRET ?? "";
const keepaliveTo = process.env.KEEPALIVE_TO_EMAIL ?? process.env.CONTACT_TO_EMAIL ?? "sales@pamca.net";

export async function handleKeepalive(req: ApiRequest, res: ApiResponse): Promise<void> {
  // Fail closed: an unset secret would otherwise leave the endpoint world-callable.
  if (!cronSecret) {
    res.status(503).json({ success: false, message: "CRON_SECRET is not configured" });
    return;
  }

  if (getHeader(req, "authorization") !== `Bearer ${cronSecret}`) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  if (!isEmailConfigured()) {
    res.status(500).json({ success: false, message: "BREVO_API_KEY is not configured" });
    return;
  }

  const sentAt = new Date().toISOString();

  // Unlike the order/contact paths, a thrown error here must NOT be swallowed —
  // the whole point is to find out that sending is broken.
  await sendBrevoEmail({
    to: [{ email: keepaliveTo }],
    subject: `PAMCA email keep-alive — ${sentAt.slice(0, 10)}`,
    html:
      `<p>Monthly automated keep-alive so the Brevo account does not lapse from inactivity.</p>` +
      `<p>Sent ${sentAt} from <code>/api/cron/keepalive</code>. No action needed.</p>` +
      `<p>If this stops arriving, transactional email is down — check BREVO_API_KEY.</p>`,
    text:
      `Monthly automated keep-alive so the Brevo account does not lapse from inactivity. ` +
      `Sent ${sentAt} from /api/cron/keepalive. No action needed. ` +
      `If this stops arriving, transactional email is down — check BREVO_API_KEY.`,
  });

  res.status(200).json({ success: true, sentAt, to: keepaliveTo });
}
