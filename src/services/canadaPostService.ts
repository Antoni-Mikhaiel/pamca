// Canada Post integration: shipping rate quotes (Get Rates) + parcel tracking.
// Credentials live in env (never in client code). Until they are filled in,
// `isCanadaPostConfigured()` is false and rating degrades to a single configurable
// fallback option instead of erroring, so checkout never hard-breaks. Mirrors the
// env/degrade pattern of squareService.ts.
//
// The Canada Post web services are XML over HTTPS with Basic auth. Responses are
// small and flat, so we build requests with template strings and parse them with
// narrow regex helpers rather than pulling in an XML dependency (the project has no
// bundler and keeps dependencies minimal).

const apiUser = process.env.CANADA_POST_API_USER ?? "";
const apiPassword = process.env.CANADA_POST_API_PASSWORD ?? "";
const environment = (process.env.CANADA_POST_ENVIRONMENT ?? "production").toLowerCase();
const customerNumber = process.env.CANADA_POST_CUSTOMER_NUMBER ?? "";
const originPostalCode = normalizePostal(process.env.CANADA_POST_ORIGIN_POSTAL_CODE ?? "");
const defaultItemWeightG = Number(process.env.CANADA_POST_DEFAULT_ITEM_WEIGHT_G ?? "500") || 500;
const fallbackShippingCents = Number(process.env.CANADA_POST_FALLBACK_SHIPPING_CENTS ?? "0") || 0;
// Service codes hidden from checkout. Defaults to DOM.RP (Regular Parcel), which on
// commercial accounts is the same price as DOM.EP (Expedited) but slower and not
// guaranteed — so we surface Expedited instead. Comma-separated; case-insensitive.
const excludedServiceCodes = new Set(
  (process.env.CANADA_POST_EXCLUDED_SERVICE_CODES ?? "DOM.RP")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

const baseUrl =
  environment === "development" || environment === "sandbox"
    ? "https://ct.soa-gw.canadapost.ca"
    : "https://soa-gw.canadapost.ca";

const RATE_NS = "http://www.canadapost.ca/ws/ship/rate-v4";

/** True once the credentials + account details needed for live rating are present. */
export function isCanadaPostConfigured(): boolean {
  return Boolean(apiUser && apiPassword && customerNumber && originPostalCode);
}

/** Per-unit fallback weight (grams) for products that have no weight set. */
export function getDefaultItemWeightGrams(): number {
  return defaultItemWeightG;
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${apiUser}:${apiPassword}`).toString("base64");
}

/** Canada Post postal codes are 6 alphanumerics, no spaces, upper-case (format ANANAN). */
function normalizePostal(value: string): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function escapeXml(value: string): string {
  return String(value).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string),
  );
}

/** Extracts the text of the first `<tag>…</tag>` (namespace-agnostic) within `xml`. */
function tagText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

/** Returns every `<tag>…</tag>` block (inner XML) found in `xml`. */
function tagBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function dollarsToCents(value: string): number {
  return Math.round((Number(value) || 0) * 100);
}

export interface ShippingRate {
  serviceCode: string;
  serviceName: string;
  /**
   * Pre-tax amount charged to the customer, in cents = Canada Post "due" minus its
   * taxes. This is the merchant's true cost net of the GST/HST it recovers as an
   * input tax credit (it already includes fuel surcharges and SMB discounts, which
   * the headline "base" rate does not), so charging it + store HST breaks even.
   */
  priceCents: number;
  /** Tax-inclusive amount actually payable to Canada Post ("due"), for reference. */
  dueCents: number;
  /** Estimated transit time in business days, when Canada Post returns it. */
  transitDays: number | null;
}

/**
 * Quotes Canada Post rates for a domestic parcel. Returns options sorted cheapest
 * first. When Canada Post is not configured (or the call fails), returns a single
 * "Standard Shipping" fallback at CANADA_POST_FALLBACK_SHIPPING_CENTS so the
 * checkout flow keeps working while the account is being wired up.
 */
export async function getShippingRates(params: {
  destinationPostalCode: string;
  weightKg: number;
}): Promise<ShippingRate[]> {
  const dest = normalizePostal(params.destinationPostalCode);
  const weightKg = Math.max(0.1, Math.round((params.weightKg || 0) * 1000) / 1000);

  if (!isCanadaPostConfigured() || !dest) return [fallbackRate()];

  const requestXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mailing-scenario xmlns="${RATE_NS}">` +
    `<customer-number>${escapeXml(customerNumber)}</customer-number>` +
    `<parcel-characteristics><weight>${weightKg}</weight></parcel-characteristics>` +
    `<origin-postal-code>${escapeXml(originPostalCode)}</origin-postal-code>` +
    `<destination><domestic><postal-code>${escapeXml(dest)}</postal-code></domestic></destination>` +
    `</mailing-scenario>`;

  let xml: string;
  try {
    const response = await fetch(`${baseUrl}/rs/ship/price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.cpc.ship.rate-v4+xml",
        Accept: "application/vnd.cpc.ship.rate-v4+xml",
        Authorization: authHeader(),
        "Accept-language": "en-CA",
      },
      body: requestXml,
    });
    xml = await response.text();
    if (!response.ok) {
      const message = tagText(xml, "message") || `Canada Post rating failed (${response.status})`;
      throw new Error(message);
    }
  } catch {
    // Network/auth/parse failure → don't block checkout; offer the fallback.
    return [fallbackRate()];
  }

  const rates = tagBlocks(xml, "price-quote").map((block) => {
    const details = tagText(block, "price-details");
    const taxes = tagText(details, "taxes");
    const taxesCents =
      dollarsToCents(tagText(taxes, "gst")) +
      dollarsToCents(tagText(taxes, "pst")) +
      dollarsToCents(tagText(taxes, "hst"));
    const dueCents = dollarsToCents(tagText(details, "due"));
    const transit = tagText(block, "expected-transit-time");
    return {
      serviceCode: tagText(block, "service-code"),
      serviceName: tagText(block, "service-name"),
      // What we charge: the full amount net of Canada Post's taxes (which we recover
      // as an ITC) — includes fuel surcharge/discounts, unlike the bare "base".
      priceCents: Math.max(0, dueCents - taxesCents),
      dueCents,
      transitDays: transit ? Number(transit) || null : null,
    };
  }).filter((r) => r.serviceCode && r.priceCents > 0 && !excludedServiceCodes.has(r.serviceCode.toUpperCase()));

  if (rates.length === 0) return [fallbackRate()];
  return rates.sort((a, b) => a.priceCents - b.priceCents);
}

function fallbackRate(): ShippingRate {
  return {
    serviceCode: "FALLBACK",
    serviceName: "Standard Shipping",
    priceCents: fallbackShippingCents,
    dueCents: fallbackShippingCents,
    transitDays: null,
  };
}

export interface TrackingEvent {
  /** ISO date (yyyy-mm-dd) when available, else the raw Canada Post value. */
  date: string;
  time: string;
  description: string;
  location: string;
}

export interface TrackingInfo {
  pin: string;
  /** Latest event description, e.g. "Delivered" / "Item in transit"; "" if none. */
  status: string;
  expectedDelivery: string | null;
  events: TrackingEvent[];
}

/**
 * Fetches the tracking detail for a Canada Post PIN. Events are returned
 * newest-first (as Canada Post orders them); `status` is the most recent event.
 * Throws on a transport/auth error so the caller can surface a friendly message.
 */
export async function getTracking(pin: string): Promise<TrackingInfo> {
  const clean = String(pin || "").replace(/\s/g, "");
  if (!clean) throw new Error("No tracking number");
  if (!apiUser || !apiPassword) throw new Error("Canada Post is not configured");

  const response = await fetch(`${baseUrl}/vis/track/pin/${encodeURIComponent(clean)}/detail`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.cpc.track-v2+xml",
      Authorization: authHeader(),
      "Accept-language": "en-CA",
    },
  });
  const xml = await response.text();
  if (!response.ok) {
    const message = tagText(xml, "message") || `Canada Post tracking failed (${response.status})`;
    throw new Error(message);
  }

  const events: TrackingEvent[] = tagBlocks(xml, "occurrence").map((block) => {
    const site = tagText(block, "event-site");
    const province = tagText(block, "event-province");
    return {
      date: tagText(block, "event-date"),
      time: tagText(block, "event-time"),
      description: tagText(block, "event-description"),
      location: [site, province].filter(Boolean).join(", "),
    };
  });

  const expected = tagText(xml, "changed-expected-date") || tagText(xml, "expected-delivery-date") || null;

  return {
    pin: clean,
    status: events[0]?.description ?? "",
    expectedDelivery: expected,
    events,
  };
}
