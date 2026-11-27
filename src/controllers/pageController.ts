import { ApiRequest, ApiResponse } from "../lib/http.js";
import { readPublicFile } from "../lib/publicFiles.js";
import { inlinePartials } from "../lib/partials.js";
import { optimizedImage } from "../lib/images.js";
import { getProductBySlug, listProducts, listProductSitemapEntries, toPublicProduct } from "../services/productService.js";

const SITE = (process.env.SITE_URL ?? "https://www.pamca.net").replace(/\/$/, "");
const DEFAULT_IMAGE = `${SITE}/images/og-image.jpg`;
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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
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

/** A public/ page with the shared header/footer inlined (crawlable navigation). */
async function readPage(name: string): Promise<string> {
  return inlinePartials(await readPublicFile(name), (partial) => readPublicFile(`partials/${partial}.html`));
}

/** Replaces the template's <title> (or appends to <head>) with the server-rendered head. */
function injectHead(template: string, head: string): string {
  const titleRe = /<title>[\s\S]*?<\/title>/;
  return titleRe.test(template) ? template.replace(titleRe, () => head) : template.replace("</head>", () => `${head}\n</head>`);
}

function sendHtml(res: ApiResponse, status: number, html: string, cache = PAGE_CACHE): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.status(status).send(html);
}

async function sendNotFound(res: ApiResponse): Promise<void> {
  let html = '<!DOCTYPE html><title>Page not found | PAMCA</title><h1>Page not found</h1><p><a href="/">PAMCA home</a></p>';
  try {
    html = await readPage("404.html");
  } catch {
    // keep the minimal fallback
  }
  sendHtml(res, 404, html, "public, max-age=0, s-maxage=60");
}

type PublicProduct = ReturnType<typeof toPublicProduct>;

function productPrice(p: PublicProduct): number {
  return Number(p.is_on_sale && p.price_sale != null ? p.price_sale : p.price_regular) || 0;
}

function productImages(p: PublicProduct): string[] {
  return ((Array.isArray(p.images) && p.images.length ? p.images : [p.image_url]).filter(Boolean) as string[]);
}

function productOffer(p: PublicProduct, url: string) {
  const saleEnd = p.is_on_sale && p.sale_end ? String(p.sale_end).slice(0, 10) : null;
  return {
    "@type": "Offer",
    url,
    priceCurrency: "CAD",
    price: productPrice(p).toFixed(2),
    // A sale price is only valid until the sale ends (Google hides listings with a past date).
    ...(saleEnd && saleEnd >= new Date().toISOString().slice(0, 10) ? { priceValidUntil: saleEnd } : {}),
    availability: Number(p.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", "@id": `${SITE}/#organization`, name: "Pharmacy Automated Mechanisms", url: `${SITE}/` },
  };
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
  const images = productImages(p);
  const image = images[0] || DEFAULT_IMAGE;
  const price = productPrice(p);
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
        offers: productOffer(p, url),
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
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="PAMCA">`,
    `<meta property="og:locale" content="en_CA">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:image:alt" content="${escapeHtml(p.name)}">`,
    `<meta property="product:price:amount" content="${price.toFixed(2)}">`,
    `<meta property="product:price:currency" content="CAD">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    // The main photo is the LCP element (a CSS background, so the browser can't find
    // it early on its own) — preload the exact resized URL the page will use.
    `<link rel="preload" as="image" href="${escapeHtml(optimizedImage(image, 828))}" fetchpriority="high">`,
    `<script type="application/ld+json">${inlineJson(jsonLd)}</script>`,
    `<script>window.__PAMCA_PRODUCT__=${inlineJson(p)};</script>`,
  ].join("\n  ");

  sendHtml(res, 200, injectHead(await readPage("product.html"), head));
}

/** One product card — must match renderProducts() in public/shared-scripts.js. */
function productCard(p: PublicProduct): string {
  const regular = Number(p.price_regular || 0);
  const sale = p.price_sale == null ? null : Number(p.price_sale);
  const saleMarkup =
    p.is_on_sale && sale != null
      ? `<div class="sale-price"><div class="sale-price-horizontal"><div class="original-price">$${regular.toFixed(2)}</div><div class="current-price">$${sale.toFixed(2)}</div></div></div>`
      : `<div class="price">$${regular.toFixed(2)}</div>`;
  const name = escapeHtml(p.name || "");
  const img = p.image_url
    ? `<img src="${escapeHtml(optimizedImage(p.image_url, 384))}" srcset="${[256, 384, 640].map((w) => `${escapeHtml(optimizedImage(p.image_url as string, w))} ${w}w`).join(", ")}" sizes="(max-width: 600px) 45vw, 260px" alt="${name}" loading="lazy" decoding="async">`
    : "";
  return `<a class="product-card${p.is_on_sale ? " on-sale-special" : ""}" href="/products/${encodeURIComponent(p.slug || "")}">${p.is_on_sale ? '<div class="sale-badge">Sale</div>' : ""}<div class="product-image">${img}</div><div class="product-content"><h3 class="product-name">${name}</h3><div class="product-price">${saleMarkup}</div></div></a>`;
}

/**
 * GET /pharmacy-products (rewritten to /api/pages/products) — the catalogue with
 * every product card rendered on the server (real links + an ItemList for search
 * engines) instead of an empty grid filled by JavaScript.
 */
export async function handleProductsListPage(_req: ApiRequest, res: ApiResponse): Promise<void> {
  const products = (await listProducts()).map(toPublicProduct);
  const template = await readPage("pharmacy-products.html");
  const emptyGrid = '<div class="products-grid"></div>';
  if (!template.includes(emptyGrid)) {
    sendHtml(res, 200, template);
    return;
  }

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Pharmacy Products",
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/products/${encodeURIComponent(p.slug)}`,
      name: p.name,
    })),
  };

  // Slim list (what the product pages read from the cache) for instant product-page paint.
  const html = template
    .replace(emptyGrid, () => `<div class="products-grid" data-ssr="1">${products.map(productCard).join("")}</div>`)
    .replace(
      "<!-- seo:end -->",
      () =>
        `<script type="application/ld+json">${inlineJson(itemList)}</script>\n  <script>window.__PAMCA_PRODUCTS__=${inlineJson(products)};</script>\n  <!-- seo:end -->`,
    );
  sendHtml(res, 200, html);
}

/** GET /sitemap.xml (rewritten to /api/sitemap) — static pages + every active product, with images. */
export async function handleSitemap(_req: ApiRequest, res: ApiResponse): Promise<void> {
  const products = await listProductSitemapEntries();
  const productUrls = products.map((p) => {
    const lastmod = p.updatedAt ? `<lastmod>${new Date(p.updatedAt).toISOString().slice(0, 10)}</lastmod>` : "";
    const imgs = p.images
      .slice(0, 10)
      .map((src) => `<image:image><image:loc>${escapeHtml(src)}</image:loc></image:image>`)
      .join("");
    return `  <url><loc>${escapeHtml(`${SITE}/products/${encodeURIComponent(p.slug)}`)}</loc>${lastmod}${imgs}</url>`;
  });
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    [...STATIC_PAGES.map((path) => `  <url><loc>${escapeHtml(`${SITE}${path}`)}</loc></url>`), ...productUrls].join("\n") +
    `\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(xml);
}

