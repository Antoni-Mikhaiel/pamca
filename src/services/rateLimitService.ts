import { createHmac } from "node:crypto";
import { supabase } from "../lib/supabase.js";

/**
 * Fixed-window rate limiting backed by the `rate_limits` table + `rate_limit_hit`
 * function (docs/supabase-schema.sql), so limits hold across all serverless
 * instances. Keys are HMAC'd so no raw IPs or phone numbers are stored.
 *
 * Fails open: if the table/function is missing or the database errors, requests
 * are allowed (and the error is logged) rather than taking order lookup down.
 */

interface Rule {
  key: string;
  max: number;
  windowSeconds: number;
}

/**
 * Guest order access (Purchase ID + phone) also authorizes edits and refunds, so
 * failed attempts are capped per phone number — which is what stops someone who
 * knows a customer's phone from enumerating the 1,000,000 possible IDs from many
 * IPs — and per IP, which stops one client from spraying many phone numbers.
 * Only failures count, so a customer reloading their own order page is never limited.
 */
const GUEST_ORDER_PER_PHONE = { max: 8, windowSeconds: 60 * 60 };
const GUEST_ORDER_PER_IP = { max: 20, windowSeconds: 15 * 60 };

export const TOO_MANY_ATTEMPTS_MESSAGE =
  "Too many unsuccessful attempts. Please wait a while and try again, or contact us for help with your order.";

const hashSecret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function hashed(value: string): string {
  return createHmac("sha256", hashSecret).update(value).digest("hex").slice(0, 40);
}

function guestOrderRules(ip: string, phone: string): Rule[] {
  const rules: Rule[] = [{ key: `guest_order:phone:${hashed(phone)}`, ...GUEST_ORDER_PER_PHONE }];
  if (ip) rules.push({ key: `guest_order:ip:${hashed(ip)}`, ...GUEST_ORDER_PER_IP });
  return rules;
}

/** True when any rule's current window has already reached its limit. One round trip. */
async function isLimited(rules: Rule[]): Promise<boolean> {
  const { data, error } = await supabase
    .from("rate_limits")
    .select("key, hits, window_start")
    .in(
      "key",
      rules.map((r) => r.key),
    );
  if (error) {
    console.error("[rate-limit] check failed (allowing request):", error.message);
    return false;
  }

  const now = Date.now();
  return rules.some((rule) => {
    const row = (data ?? []).find((d) => d.key === rule.key) as
      | { hits: number; window_start: string }
      | undefined;
    if (!row) return false;
    const started = new Date(row.window_start).getTime();
    if (!Number.isFinite(started) || now - started >= rule.windowSeconds * 1000) return false;
    return Number(row.hits) >= rule.max;
  });
}

async function recordHit(rules: Rule[]): Promise<void> {
  const results = await Promise.all(
    rules.map((rule) =>
      supabase.rpc("rate_limit_hit", { p_key: rule.key, p_window_seconds: rule.windowSeconds }),
    ),
  );
  for (const { error } of results) {
    if (error) console.error("[rate-limit] record failed:", error.message);
  }
}

/**
 * Per-IP request budgets for endpoints that cost something on every call: account
 * creation (spam accounts), the contact form (email to the shop), checkout (a
 * pending order + a Square payment link each time) and shipping quotes (Canada Post
 * API quota). Generous for real customers; they only bite on automated abuse.
 */
const REQUEST_LIMITS = {
  signup: { max: 5, windowSeconds: 60 * 60 },
  contact: { max: 5, windowSeconds: 60 * 60 },
  checkout: { max: 15, windowSeconds: 60 * 60 },
  shippingRates: { max: 40, windowSeconds: 10 * 60 },
} as const;

export type LimitedAction = keyof typeof REQUEST_LIMITS;

/**
 * Counts one request for `action` from `ip` and returns whether it's within budget.
 * One round trip. Allows the request when the IP is unknown (local dev) or the
 * limiter errors (fail open, logged).
 */
export async function allowRequest(action: LimitedAction, ip: string): Promise<boolean> {
  if (!ip) return true;
  const { max, windowSeconds } = REQUEST_LIMITS[action];
  const { data, error } = await supabase.rpc("rate_limit_hit", {
    p_key: `${action}:ip:${hashed(ip)}`,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(`[rate-limit] ${action} hit failed (allowing request):`, error.message);
    return true;
  }
  return Number(data) <= max;
}

export const TOO_MANY_REQUESTS_MESSAGE = "Too many requests. Please wait a few minutes and try again.";

/** Whether guest order access is currently blocked for this IP or phone number. */
export function isGuestOrderAccessBlocked(ip: string, normalizedPhone: string): Promise<boolean> {
  return isLimited(guestOrderRules(ip, normalizedPhone));
}

/** Counts one failed guest order lookup (wrong Purchase ID for this phone). */
export function recordGuestOrderAccessFailure(ip: string, normalizedPhone: string): Promise<void> {
  return recordHit(guestOrderRules(ip, normalizedPhone));
}
