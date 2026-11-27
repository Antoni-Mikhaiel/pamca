/**
 * Unit tests for pure logic that handles money, security and correctness.
 * Run: npm test  (Node's built-in test runner via tsx; no network or database).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Modules that import the Supabase client need these set before they load; the
// client never connects in these tests.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { normalizePhone, validateCustomerDetails } = await import("../src/lib/customer.js");
const { calculateTaxCents } = await import("../src/services/taxService.js");
const { buildCombinationKeys, resolveCombinationStock, variantKey } = await import("../src/lib/variants.js");
const { verifyWebhookSignature } = await import("../src/services/squareService.js");
const { UserError, publicErrorMessage, GENERIC_ERROR } = await import("../src/lib/errors.js");
const { buildMiniCartHtml } = await import("../src/lib/miniCartHtml.js");
const { versionAssets, contentHash } = await import("../src/lib/assets.js");
const { inlinePartials } = await import("../src/lib/partials.js");
const { optimizedImage } = await import("../src/lib/images.js");

test("normalizePhone: Canadian numbers to +1XXXXXXXXXX, rejects bad input", () => {
  assert.equal(normalizePhone("(416) 322-3444"), "+14163223444");
  assert.equal(normalizePhone("1-416-322-3444"), "+14163223444");
  assert.equal(normalizePhone("+1 416 322 3444"), "+14163223444");
  assert.equal(normalizePhone("322-3444"), null);
  assert.equal(normalizePhone(""), null);
});

test("validateCustomerDetails: address required for shipping, not for pickup", () => {
  const base = { firstName: "A", lastName: "B", pharmacyName: "P", email: "a@b.co", phone: "4163223444" };
  assert.equal(validateCustomerDetails(base).ok, false);
  const pickup = validateCustomerDetails(base, { requireAddress: false });
  assert.equal(pickup.ok, true);
  const shipped = validateCustomerDetails({ ...base, streetNumber: "1920", streetName: "Yonge St", city: "Toronto", province: "on", postalCode: "m4s 3e6" });
  assert.equal(shipped.ok, true);
  if (shipped.ok) assert.equal(shipped.value.province, "ON");
  assert.equal(validateCustomerDetails({ ...base, email: "not-an-email" }, { requireAddress: false }).ok, false);
});

test("calculateTaxCents: rounds to whole cents", () => {
  assert.equal(calculateTaxCents(10000, 13), 1300);
  assert.equal(calculateTaxCents(1999, 13), 260); // 259.87 -> 260
  assert.equal(calculateTaxCents(5000, 0), 0);
});

test("variant stock: combination keys and per-combination stock", () => {
  const groups = [
    { label: "Style", affectsPricing: true, options: [{ value: "Wall", price: null, salePercent: null, stock: null }, { value: "Desk", price: null, salePercent: null, stock: null }] },
    { label: "Colour", affectsPricing: false, options: [{ value: "White", price: null, salePercent: null, stock: null }] },
  ];
  assert.deepEqual(buildCombinationKeys(groups), ["Wall / White", "Desk / White"]);
  assert.equal(variantKey(["Desk", "White"]), "Desk / White");
  const variants = [{ key: "Wall / White", stock: 4 }, { key: "Desk / White", stock: 0 }];
  assert.equal(resolveCombinationStock(variants, groups, ["Wall", "White"], 99), 4);
  assert.equal(resolveCombinationStock(variants, groups, ["Desk", "White"], 99), 0);
  assert.equal(resolveCombinationStock(variants, groups, ["Unknown", "White"], 99), 0);
});

test("verifyWebhookSignature: fails closed without a key, accepts only a valid signature", () => {
  const body = '{"type":"payment.updated"}';
  const url = "https://www.pamca.net/api/checkout/webhook";
  const sign = (key: string) => createHmac("sha256", key).update(url + body).digest("base64");
  const saved = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  try {
    delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    assert.equal(verifyWebhookSignature(body, sign("x"), [url]), false);
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "secret";
    assert.equal(verifyWebhookSignature(body, sign("secret"), [url]), true);
    assert.equal(verifyWebhookSignature(body, sign("wrong"), [url]), false);
    assert.equal(verifyWebhookSignature(body + " ", sign("secret"), [url]), false);
    assert.equal(verifyWebhookSignature(body, sign("secret"), ["https://pamca.net/other"]), false);
  } finally {
    if (saved === undefined) delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    else process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = saved;
  }
});

test("publicErrorMessage: customer messages pass through, internals are masked", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(publicErrorMessage(new UserError("Only 3 left in stock."), "t"), "Only 3 left in stock.");
    assert.equal(publicErrorMessage(new Error('relation "orders" does not exist'), "t"), GENERIC_ERROR);
    assert.equal(publicErrorMessage("boom", "t", "Custom fallback"), "Custom fallback");
  } finally {
    console.error = originalError;
  }
});

test("buildMiniCartHtml: escapes product names and image URLs", () => {
  const html = buildMiniCartHtml([
    { id: "1", cart_token: "t", product_id: 1, variation_id: null, quantity: 2, product_name: '<img src=x onerror="alert(1)">', variation_label: null, unit_price: 5, image_url: 'https://x/"><script>' },
  ]);
  assert.ok(!html.includes("<img src=x"), "raw tag must not appear");
  assert.ok(!html.includes("<script>"), "raw script must not appear");
  assert.ok(html.includes("&lt;img src=x"));
});

test("versionAssets: stamps same-origin assets, leaves others alone", async () => {
  const html = '<link rel="stylesheet" href="/a.css"><script src="/b.js"></script><img src="https://cdn.example/c.png"><a href="/page">x</a>';
  const out = await versionAssets(html, async (p) => (p === "/a.css" ? "aaaa" : p === "/b.js" ? "bbbb" : null));
  assert.ok(out.includes('href="/a.css?v=aaaa"'));
  assert.ok(out.includes('src="/b.js?v=bbbb"'));
  assert.ok(out.includes('src="https://cdn.example/c.png"'));
  assert.ok(out.includes('href="/page"'));
  assert.equal(contentHash("same"), contentHash("same"));
  assert.notEqual(contentHash("a"), contentHash("b"));
});

test("inlinePartials: fills empty placeholders only", async () => {
  const page = '<body><div id="header-placeholder"></div><main/><div id="footer-placeholder"></div></body>';
  const out = await inlinePartials(page, async (n) => `<${n}>${n}</${n}>`);
  assert.ok(out.includes('<div id="header-placeholder">\n<header>header</header>\n</div>'));
  assert.ok(out.includes("<footer>footer</footer>"));
  assert.equal(await inlinePartials("<p>no placeholders</p>", async () => "x"), "<p>no placeholders</p>");
});

test("optimizedImage: only Supabase Storage images on Vercel are resized", () => {
  const src = "https://abc.supabase.co/storage/v1/object/public/product-images/x.png";
  const saved = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    assert.equal(optimizedImage(src, 384), src);
    process.env.VERCEL = "1";
    assert.equal(optimizedImage(src, 384), `/_vercel/image?url=${encodeURIComponent(src)}&w=384&q=75`);
    assert.equal(optimizedImage("https://other.example/x.png", 384), "https://other.example/x.png");
  } finally {
    if (saved === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = saved;
  }
});
