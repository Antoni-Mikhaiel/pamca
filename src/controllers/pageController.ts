import { ApiRequest, ApiResponse } from "../lib/http.js";
import { readPublicFile } from "../lib/publicFiles.js";
import { getProductBySlug, listProducts, toPublicProduct } from "../services/productService.js";

const SITE = (process.env.SITE_URL ?? "https://www.pamca.net").replace(/\/$/, "");
const DEFAULT_IMAGE = `${SITE}/images/pamca.png`;
// Same for every visitor; the CDN serves it and refreshes in the background.
const PAGE_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";

/** Indexable static pages, at their canonical URLs (mirrors vercel.json rewrites). */
const STATIC_PAGES = [
  "/",
  "/pharmacy-products",
  "/minor-ailments-prescribing-solution",
  "/incident-reporting",
  "/about-us",
  "/contact-us",
  "/privacy-policy",
  "/terms-and-conditions",
];

function escapeAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** JSON safe to inline in a <script> (no "</script>" or "<!--" break-out). */
function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}

function summarize(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

async function sendNotFound(res: ApiResponse): Promise<void> {
  let html = "<!DOCTYPE html><title>Page not found | PAMCA</title><h1>Page not found</h1><p><a href=\"/\">PAMCA home</a></p>";
  try {
    html = await readPublicFile("404.html");
  } catch {
    // keep the minimal fallback
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
  res.status(404).send(html);
}

/**
 * GET /products/:slug (rewritten to /api/pages/product/:slug) — the product page
 * with its SEO head rendered on the server: title, description, canonical, Open
 * Graph/Twitter tags and Product + BreadcrumbList structured data, so crawlers and
 * link previews (which don't run JavaScript) see real product information. The
 * product data is inlined too, so the page renders without an API round trip.
 */
export async function handleProductPage(req: ApiRequest, res: ApiResponse): Promise<void> {
  const slug = String(req.query?.slug ?? "").trim();
  const product = slug ? await getProductBySlug(slug) : null;
  if (!product) {
    await sendNotFound(res);
    return;
  }

  const p = toPublicProduct(product);
  const url = `${SITE}/products/${encodeURIComponent(p.slug)}`;
  const images = (Array.isArray(p.images) && p.images.length ? p.images : [p.image_url]).filter(Boolean) as string[];
  const image = images[0] || DEFAULT_IMAGE;
  const price = Number(p.is_on_sale && p.price_sale != null ? p.price_sale : p.price_regular) || 0;
  const inStock = Number(p.stock) > 0;
  const title = `${p.name} | PAMCA`;
  const description = summarize(p.description || `${p.name} — available from PAMCA, shipped across Canada.`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${url}#product`,
        name: p.name,
        description: p.description || undefined,
        image: images.length ? images : [DEFAULT_IMAGE],
        sku: p.slug,
        url,
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: "CAD",
          price: price.toFixed(2),
          availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          seller: { "@type": "Organization", name: "Pharmacy Automated Mechanisms", url: `${SITE}/` },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Pharmacy Products", item: `${SITE}/pharmacy-products` },
          { "@type": "ListItem", position: 3, name: p.name, item: url },
        ],
      },
    ],
  };

  const head = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    `<link rel="canonical" href="${escapeAttr(url)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="PAMCA">`,
    `<meta property="og:locale" content="en_CA">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${escapeAttr(url)}">`,
    `<meta property="og:image" content="${escapeAttr(image)}">`,
    `<meta property="product:price:amount" content="${price.toFixed(2)}">`,
    `<meta property="product:price:currency" content="CAD">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(image)}">`,
    `<link rel="preload" as="image" href="${escapeAttr(image)}">`,
    `<script type="application/ld+json">${inlineJson(jsonLd)}</script>`,
    `<script>window.__PAMCA_PRODUCT__=${inlineJson(p)};</script>`,
  ].join("\n  ");

  const template = await readPublicFile("product.html");
  const titleRe = /<title>[\s\S]*?<\/title>/;
  const html = titleRe.test(template) ? template.replace(titleRe, () => head) : template.replace("</head>", () => `${head}\n</head>`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", PAGE_CACHE);
  res.status(200).send(html);
}

/** GET /sitemap.xml (rewritten to /api/sitemap) — static pages + every active product. */
export async function handleSitemap(_req: ApiRequest, res: ApiResponse): Promise<void> {
  const products = await listProducts();
  const urls = [
    ...STATIC_PAGES.map((p) => `${SITE}${p}`),
    ...products.map((p) => `${SITE}/products/${encodeURIComponent(p.slug)}`),
  ];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${escapeAttr(u)}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(xml);
}
